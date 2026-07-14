import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'

/**
 * Phase/practice-identity (Manisha 2026-06-12 Access Control §1).
 *
 * Yields the active practice context for the current request, derived from
 * the JWT's `activePracticeId` claim (set at sign-in / select-practice /
 * switch-practice). Controllers pass this into audit-write service methods
 * so EscalationEvent.actorPracticeContext, AuthLog.practiceContext,
 * ProfileVerificationLog.practiceContext, and DeviationAlert
 * .actorPracticeContext all capture the practice the actor was acting as.
 *
 * NULL for SUPER_ADMIN / HEALPLACE_OPS / PATIENT sessions — Manisha allows
 * NULL in those rows; the access-control doc treats org-wide acts as
 * unscoped by design.
 *
 * Usage:
 *   acknowledge(
 *     @CurrentUser() user: { id: string },
 *     @ActiveContext() ctx: { practiceId: string | null },
 *   ) { ... }
 */
export const ActiveContext = createParamDecorator(
  (_data: unknown, host: ExecutionContext): { practiceId: string | null } => {
    const req = host.switchToHttp().getRequest<Request>()
    const user = (req.user ?? null) as { activePracticeId?: string | null } | null
    return { practiceId: user?.activePracticeId ?? null }
  },
)
