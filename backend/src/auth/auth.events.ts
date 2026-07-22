/**
 * Internal event carrying a just-written failed AuthLog row to the real-time
 * repeated-failed-auth evaluator. Emitted (fire-and-forget) by the auth-failure
 * Prisma extension after `authLog.create` persists a row with `success: false`,
 * so every existing and future auth-failure call site is covered with zero
 * call-site changes — `logAuthEvent` is private in AuthService AND copy-mirrored
 * in UsersService, with ~60 call sites, so wrapping the write is the only way to
 * cover both without patching them all.
 *
 * Consumed by a single `@OnEvent` handler (RealtimeFailedAuthService) whose async
 * wrapper swallows errors — a failed evaluation can never propagate back into the
 * sign-in path. Mirrors push.events.ts / push-dispatch.extension.ts exactly.
 */
export const AUTH_EVENTS = {
  FAILURE: 'auth.failure',
} as const

export interface AuthFailureEvent {
  /** The failed AuthLog row's own id. */
  authLogId: string
  /** The login identifier (email / OTP subject). Null identifiers are ignored. */
  identifier: string | null
  userId: string | null
  ipAddress: string | null
  /** The AuthLog `event` name, e.g. 'otp_failed', 'mfa_challenge_failed'. */
  event: string
  practiceContext: string | null
  /** When the row was written. */
  createdAt: Date
}
