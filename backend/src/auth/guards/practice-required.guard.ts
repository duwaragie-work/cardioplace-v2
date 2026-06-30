import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { UserRole } from '../../generated/prisma/enums.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js'

interface JwtUser {
  id: string
  roles: UserRole[]
  activePracticeId?: string | null
}

// Clinical roles whose practice context is mandatory — they must pick ONE
// practice to act as before reaching any protected surface. Mirrors
// MULTI_PRACTICE_ROLES in auth.service.ts.
const PRACTICE_SCOPED_ROLES: readonly UserRole[] = [
  UserRole.PROVIDER,
  UserRole.MEDICAL_DIRECTOR,
]

// Org-wide roles legitimately act with a NULL practice context (audit captures
// null by design), so they bypass the gate even if they co-hold a clinical role.
const ORG_WIDE_ROLES: readonly UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.HEALPLACE_OPS,
]

/**
 * Practice-selection gate (Manisha 2026-06-12 Access Control §1). A multi-
 * practice provider/medical-director must choose WHICH practice they're acting
 * as before any protected route. The reordered sign-in flow already routes
 * them through the selector, but a first-time enrollee holds a real (null-
 * practice) session during TOTP setup — this guard is the teeth that stops
 * that session reaching the dashboard until a practice is chosen.
 *
 * Registered as a global APP_GUARD AFTER JwtAuthGuard + RolesGuard so req.user
 * (incl. the activePracticeId claim) is populated. The DB lookup only runs for
 * a clinical-role session with a NULL practice — the rare in-between state — so
 * fully-resolved sessions pay nothing.
 */
@Injectable()
export class PracticeRequiredGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtUser }>()
    const user = req.user
    if (!user?.roles?.length) return true

    // Always allow the routes needed to GET OUT of the gate: pick/switch a
    // practice, finish MFA enrollment, read own profile, and log out.
    if (this.isAlwaysAllowed(req.path)) return true

    // Org-wide roles act unscoped — a null practice is correct for them.
    if (user.roles.some((r) => ORG_WIDE_ROLES.includes(r))) return true

    // Only clinical multi-practice roles are gated. Coordinators auto-resolve
    // to their single practice; patients have no practice context.
    if (!user.roles.some((r) => PRACTICE_SCOPED_ROLES.includes(r))) return true

    // A chosen (or single auto-resolved) practice means we're done.
    if (user.activePracticeId) return true

    // Null practice + clinical role: block only if they actually have more than
    // one membership (i.e. a choice is genuinely pending). A 0/1-membership user
    // never reaches a null-practice session here, but the count keeps the gate
    // from misfiring on edge data.
    const [providerRows, medDirRows] = await Promise.all([
      this.prisma.practiceProvider.findMany({
        where: { userId: user.id },
        select: { practiceId: true },
      }),
      this.prisma.practiceMedicalDirector.findMany({
        where: { userId: user.id },
        select: { practiceId: true },
      }),
    ])
    const distinct = new Set<string>([
      ...providerRows.map((r) => r.practiceId),
      ...medDirRows.map((r) => r.practiceId),
    ])
    if (distinct.size <= 1) return true

    throw new ForbiddenException({
      message: 'Select a practice to continue.',
      errorCode: 'practice_select_required',
    })
  }

  private isAlwaysAllowed(path: string): boolean {
    return (
      path.includes('/auth/select-practice') ||
      path.includes('/auth/switch-practice') ||
      path.includes('/auth/mfa/enroll') ||
      path.includes('/auth/profile') ||
      path.endsWith('/auth/logout')
    )
  }
}
