import { ForbiddenException, Injectable } from '@nestjs/common'
import { UserRole } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'

export interface ActorUser {
  id: string
  roles: UserRole[]
}

/**
 * Service-layer scope guard for admin patient/practice mutations. The
 * controller-level `@Roles()` decorator answers "is this role allowed to
 * touch *any* patient through this endpoint" — this service answers "is
 * this *specific* user allowed to touch *this* patient / practice."
 *
 * May 2026 access-scope decision — see docs/ACCESS_SCOPE.md §3 + §7.6.
 * Scope rules:
 *   • SUPER_ADMIN, HEALPLACE_OPS → all patients / all practices.
 *   • MEDICAL_DIRECTOR → only patients whose assignment.practiceId is in
 *     the MD's PracticeMedicalDirector memberships.
 *   • PROVIDER → only patients whose assignment lists them as primary or
 *     backup provider.
 *
 * Throws ForbiddenException on deny (translated to HTTP 403 by Nest).
 * Callers should `await` this before reaching into Prisma to mutate.
 */
@Injectable()
export class PatientAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Patient-detail mutations (threshold edit, complete-onboarding, alert
   * resolve, profile verify, medication verify). Returns void on grant,
   * throws on deny.
   */
  async assertCanAccessPatient(
    actor: ActorUser,
    patientUserId: string,
  ): Promise<void> {
    if (this.isUnscoped(actor)) return

    const assignment = await this.prisma.patientProviderAssignment.findUnique({
      where: { userId: patientUserId },
      select: {
        practiceId: true,
        primaryProviderId: true,
        backupProviderId: true,
      },
    })

    if (actor.roles.includes(UserRole.MEDICAL_DIRECTOR)) {
      // MED_DIR with no assignment row can't act — patient hasn't been
      // assigned to a practice yet. OPS/SUPER handle that initial setup.
      if (assignment && (await this.medHeadsPractice(actor.id, assignment.practiceId))) {
        return
      }
    }

    if (
      actor.roles.includes(UserRole.PROVIDER) &&
      assignment &&
      (assignment.primaryProviderId === actor.id ||
        assignment.backupProviderId === actor.id)
    ) {
      return
    }

    throw new ForbiddenException(
      `Patient ${patientUserId} is outside your role scope`,
    )
  }

  /**
   * Care-team mutation guard for `assignment.controller.ts`. MED_DIR can
   * only mutate assignments inside practices they head; OPS/SUPER are
   * unscoped. On update flows the caller must pass *both* the existing
   * practiceId and the (optional) new practiceId so a MED_DIR can't move
   * a patient out of their practice into one they don't head.
   */
  async assertCanModifyPracticeAssignment(
    actor: ActorUser,
    practiceIds: string | string[],
  ): Promise<void> {
    if (this.isUnscoped(actor)) return

    if (!actor.roles.includes(UserRole.MEDICAL_DIRECTOR)) {
      throw new ForbiddenException(
        'Care-team assignment requires MEDICAL_DIRECTOR, HEALPLACE_OPS, or SUPER_ADMIN',
      )
    }

    const ids = Array.isArray(practiceIds) ? practiceIds : [practiceIds]
    for (const practiceId of ids) {
      const ok = await this.medHeadsPractice(actor.id, practiceId)
      if (!ok) {
        throw new ForbiddenException(
          `Practice ${practiceId} is outside your MED_DIR scope`,
        )
      }
    }
  }

  /**
   * Build the role-scoped where-clause fragment for patient list / alert
   * queue queries. Returns `undefined` when the actor is unscoped (so the
   * caller's where-clause stays open). Returns a Prisma fragment otherwise.
   *
   * Usage:
   *   const scope = await access.patientScopeFilter(actor)
   *   prisma.user.findMany({ where: { ...baseWhere, ...(scope ?? {}) } })
   */
  async patientScopeFilter(
    actor: ActorUser,
  ): Promise<{ providerAssignmentAsPatient: Record<string, unknown> } | undefined> {
    if (this.isUnscoped(actor)) return undefined

    if (actor.roles.includes(UserRole.MEDICAL_DIRECTOR)) {
      const practiceIds = await this.practicesHeadedBy(actor.id)
      return {
        providerAssignmentAsPatient: {
          is: { practiceId: { in: practiceIds } },
        },
      }
    }

    if (actor.roles.includes(UserRole.PROVIDER)) {
      return {
        providerAssignmentAsPatient: {
          is: {
            OR: [
              { primaryProviderId: actor.id },
              { backupProviderId: actor.id },
            ],
          },
        },
      }
    }

    // No admin scope grants visibility — return an impossible filter so
    // queries return empty rather than 500.
    return {
      providerAssignmentAsPatient: { is: { id: '__never__' } },
    }
  }

  private isUnscoped(actor: ActorUser): boolean {
    return (
      actor.roles.includes(UserRole.SUPER_ADMIN) ||
      actor.roles.includes(UserRole.HEALPLACE_OPS)
    )
  }

  private async medHeadsPractice(
    userId: string,
    practiceId: string,
  ): Promise<boolean> {
    const row = await this.prisma.practiceMedicalDirector.findUnique({
      where: { practiceId_userId: { practiceId, userId } },
      select: { id: true },
    })
    return row !== null
  }

  private async practicesHeadedBy(userId: string): Promise<string[]> {
    const rows = await this.prisma.practiceMedicalDirector.findMany({
      where: { userId },
      select: { practiceId: true },
    })
    return rows.map((r) => r.practiceId)
  }
}
