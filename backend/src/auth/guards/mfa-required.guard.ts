import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { UserRole } from '../../generated/prisma/enums.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js'

interface JwtUser {
  id: string
  roles: UserRole[]
}

// Roles for which TOTP enrollment is mandatory (Manisha 2026-06-12 §6).
const MFA_REQUIRED_ROLES: readonly UserRole[] = [
  UserRole.PROVIDER,
  UserRole.MEDICAL_DIRECTOR,
  UserRole.COORDINATOR,
  UserRole.HEALPLACE_OPS,
  UserRole.SUPER_ADMIN,
]

/**
 * Force-enrollment gate (Manisha 2026-06-12 Access Control §6). Once
 * MFA_ENFORCEMENT_ENABLED is on, a provider/admin who has NOT completed TOTP
 * enrollment is blocked from every route except the enrollment endpoints and
 * logout, with a discriminated errorCode the FE uses to redirect to the
 * enrollment page.
 *
 * Registered as a global APP_GUARD AFTER JwtAuthGuard + RolesGuard, so by the
 * time it runs the request is authenticated and req.user is populated. Gated
 * entirely by the env flag so it can be deployed dark and flipped on at
 * cutover (after existing testers have enrolled) without code changes.
 */
@Injectable()
export class MfaRequiredGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Dark until cutover.
    if (this.config.get<string>('MFA_ENFORCEMENT_ENABLED') !== 'true') {
      return true
    }

    // Public routes carry no authenticated user — nothing to enforce.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const req = context.switchToHttp().getRequest<Request & { user?: JwtUser }>()
    const user = req.user
    if (!user?.roles?.length) return true

    // Patients and other non-mandatory roles are never force-enrolled.
    if (!user.roles.some((r) => MFA_REQUIRED_ROLES.includes(r))) return true

    // Always allow the enrollment endpoints + logout so a non-enrolled user
    // can actually get out of the gate.
    if (this.isAlwaysAllowed(req.path)) return true

    const cred = await this.prisma.totpCredential.findUnique({
      where: { userId: user.id },
      select: { enrolledAt: true },
    })
    if (cred?.enrolledAt) return true

    throw new ForbiddenException({
      message: 'Two-factor authentication setup is required before continuing.',
      errorCode: 'mfa_enrollment_required',
    })
  }

  private isAlwaysAllowed(path: string): boolean {
    return (
      path.includes('/auth/mfa/enroll') || path.endsWith('/auth/logout')
    )
  }
}
