import type { EventEmitter2 } from '@nestjs/event-emitter'
import { Prisma } from '../../generated/prisma/client.js'
import { AUTH_EVENTS, type AuthFailureEvent } from '../../auth/auth.events.js'

/**
 * Fires the real-time repeated-failed-auth evaluator on every FAILED auth
 * attempt, with ZERO call-site changes — the same "one extension covers every
 * write" approach push-dispatch.extension.ts uses for notifications. Wraps
 * `authLog.create`: after the row persists, if `success === false` it emits
 * AUTH_EVENTS.FAILURE, which RealtimeFailedAuthService's @OnEvent handler turns
 * into a near-real-time exception + ops page when the burst threshold is hit.
 *
 * Why here and not in logAuthEvent: that method is PRIVATE in AuthService and
 * copy-mirrored in UsersService, across ~60 call sites. Wrapping the write is
 * the only place that covers both without patching every site.
 *
 * SAFETY: the emit is fire-and-forget and fully guarded — it runs AFTER
 * `query(args)` returns (so the row exists) and any throw here is swallowed. A
 * failed evaluation can never affect the auth-log write or the sign-in path.
 * Successful auth rows (`success: true`) are untouched. `createMany` is NOT
 * wrapped (it returns a count, not rows); no auth path uses it.
 *
 * The dev perma-OTP identifier ('666666') is deliberately NOT filtered here —
 * the evaluator's shared aggregation applies the same exclusion the batch
 * detector does, so the two paths stay in lockstep. Filtering in two places is
 * how they would drift.
 */

/** The shape of an authLog.create result the extension inspects. */
export interface AuthLogRowLike {
  id?: string
  identifier?: string | null
  userId?: string | null
  ipAddress?: string | null
  event?: string
  practiceContext?: string | null
  success?: boolean
  createdAt?: Date
}

/**
 * Decide whether a just-written authLog row should page — and build the event
 * if so. Extracted as a pure function so the emit decision is unit-testable
 * without a Prisma client (the extension's query hook cannot be invoked in
 * isolation). Returns null when the row is a SUCCESS, has no id, or is absent.
 *
 * `now` is injectable so the createdAt fallback is deterministic in tests.
 */
export function buildAuthFailureEvent(
  row: AuthLogRowLike | null | undefined,
  now: Date = new Date(),
): AuthFailureEvent | null {
  if (!row || row.success !== false || !row.id) return null
  return {
    authLogId: row.id,
    identifier: row.identifier ?? null,
    userId: row.userId ?? null,
    ipAddress: row.ipAddress ?? null,
    event: row.event ?? '',
    practiceContext: row.practiceContext ?? null,
    createdAt: row.createdAt ?? now,
  }
}

/**
 * Emit AUTH_EVENTS.FAILURE for a just-persisted authLog row when it is a
 * failure. Never throws — a listener that blows up must not break the auth-log
 * write or the sign-in path. Extracted from the query hook so the emit +
 * swallow-all guarantee is unit-testable (Prisma.defineExtension hides the hook
 * itself, so the extension object cannot be invoked directly).
 */
export function dispatchAuthFailure(
  eventEmitter: Pick<EventEmitter2, 'emit'>,
  result: unknown,
): void {
  try {
    const event = buildAuthFailureEvent(result as AuthLogRowLike | null)
    if (event) eventEmitter.emit(AUTH_EVENTS.FAILURE, event)
  } catch {
    // Dispatch must never affect the write path — swallow everything.
  }
}

export function authFailureExtension(eventEmitter: EventEmitter2) {
  return Prisma.defineExtension({
    name: 'auth-failure-dispatch',
    query: {
      authLog: {
        async create({ args, query }) {
          const result = await query(args)
          dispatchAuthFailure(eventEmitter, result)
          return result
        },
      },
    },
  })
}
