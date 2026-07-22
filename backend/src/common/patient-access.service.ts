import { ForbiddenException, Injectable, Logger } from '@nestjs/common'
import { UserRole } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'

export interface ActorUser {
  id: string
  roles: UserRole[]
  /**
   * Phase/practice-identity strict scoping (Duwaragie 2026-06-19) — the
   * practice the session is acting as, carried on the JWT (JwtStrategy
   * .validate returns it). When set, patient visibility narrows to ONLY
   * this practice. Undefined/null for legacy sessions issued before the
   * claim existed and for org-wide roles (SUPER_ADMIN / HEALPLACE_OPS),
   * which keep union visibility.
   */
  activePracticeId?: string | null
}

/**
 * Service-layer scope guard for admin patient/practice mutations. The
 * controller-level `@Roles()` decorator answers "is this role allowed to
 * touch *any* patient through this endpoint" — this service answers "is
 * this *specific* user allowed to touch *this* patient / practice."
 *
 * May 2026 access-scope decision — see docs/ACCESS_SCOPE.md §3 + §7.6.
 * June 2026 update (Manisha 2026-06-12 Doc 3 Q2): PROVIDER now sees every
 * patient in their practices (mirrors MEDICAL_DIRECTOR). Assignment still
 * governs alert routing + escalation; only data visibility widened.
 * Scope rules:
 *   • SUPER_ADMIN, HEALPLACE_OPS → all patients / all practices.
 *   • MEDICAL_DIRECTOR → only patients whose assignment.practiceId is in
 *     the MD's PracticeMedicalDirector memberships.
 *   • PROVIDER → only patients whose assignment.practiceId is in the
 *     provider's PracticeProvider memberships.
 *
 * Throws ForbiddenException on deny (translated to HTTP 403 by Nest).
 * Callers should `await` this before reaching into Prisma to mutate.
 */
@Injectable()
export class PatientAccessService {
  private readonly logger = new Logger(PatientAccessService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deny messages are deliberately GENERIC — they never name the patient or
   * practice that was refused (alert-resolve IDOR review, 2026-07-21 · S1).
   *
   * The escalation deep-link design keeps the patient **user id** out of URLs
   * because that is the sensitive identifier; the alert id is the opaque one.
   * An interpolated id here handed that user id back to ANY authenticated
   * staff account — including one scoped to a different practice — in exchange
   * for an alert id, reconstructing the exact alertId → patientId mapping the
   * design removed. Not an IDOR (no clinical data, needs a valid staff JWT),
   * but it undercuts the "an alert id is inert without authorization" property
   * the whole Amplify decision rests on.
   *
   * The id still reaches server-side logs via `denyLog()` — V-05
   * (common/logging/log-redact.ts) permits IDs/booleans/byte counts in stdout
   * and bars only clinical content, and a scope verdict carries neither
   * condition nor reading.
   *
   * ⚠️ Do NOT "restore" the helpful id to these strings. patient-access
   * .service.spec.ts asserts the identifier is absent and will fail.
   */
  private denyLog(scope: string, identifier: string, actorId: string): void {
    this.logger.warn(
      `access denied (${scope}): actor=${actorId} target=${identifier}`,
    )
  }

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
      // Strict scoping (Duwaragie 2026-06-19): when acting as a practice,
      // the patient's practice must match the active context.
      if (
        assignment &&
        this.inActiveScope(actor, assignment.practiceId) &&
        (await this.medHeadsPractice(actor.id, assignment.practiceId))
      ) {
        return
      }
    }

    if (
      actor.roles.includes(UserRole.PROVIDER) &&
      assignment &&
      this.inActiveScope(actor, assignment.practiceId) &&
      (await this.providerInPractice(actor.id, assignment.practiceId))
    ) {
      return
    }

    this.denyLog('patient', patientUserId, actor.id)
    throw new ForbiddenException(
      'Requested record is outside your role scope',
    )
  }

  /**
   * Care-team mutation guard for `assignment.controller.ts`. MED_DIR can
   * only mutate assignments inside practices they head; OPS/SUPER are
   * unscoped. On update flows the caller must pass *both* the existing
   * practiceId and the (optional) new practiceId so a MED_DIR can't move
   * a patient out of their practice into one they don't head.
   *
   * COORDINATOR is NOT permitted here (2026-07-01 walkback from #116 —
   * care-team assignment is a clinical decision, not front-desk). The
   * controller-level @Roles already blocks them; this is the defense-in-
   * depth service check for the roles that do get through.
   */
  async assertCanModifyPracticeAssignment(
    actor: ActorUser,
    practiceIds: string | string[],
  ): Promise<void> {
    if (this.isUnscoped(actor)) return

    const ids = Array.isArray(practiceIds) ? practiceIds : [practiceIds]

    if (!actor.roles.includes(UserRole.MEDICAL_DIRECTOR)) {
      throw new ForbiddenException(
        'Care-team assignment requires MEDICAL_DIRECTOR, HEALPLACE_OPS, or SUPER_ADMIN',
      )
    }

    for (const practiceId of ids) {
      const ok = await this.medHeadsPractice(actor.id, practiceId)
      if (!ok) {
        this.denyLog('practice-assignment', practiceId, actor.id)
        throw new ForbiddenException(
          'Requested record is outside your MED_DIR scope',
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
          is: { practiceId: { in: this.scopeToActive(actor, practiceIds) } },
        },
      }
    }

    if (actor.roles.includes(UserRole.PROVIDER)) {
      const practiceIds = await this.practicesForProvider(actor.id)
      return {
        providerAssignmentAsPatient: {
          is: { practiceId: { in: this.scopeToActive(actor, practiceIds) } },
        },
      }
    }

    // No admin scope grants visibility — return an impossible filter so
    // queries return empty rather than 500.
    return {
      providerAssignmentAsPatient: { is: { id: '__never__' } },
    }
  }

  /**
   * Where-clause fragment for the **dashboard alert queue** — the provider's
   * personal work list. Identical to `patientScopeFilter()` for org-wide roles
   * (SUPER_ADMIN / HEALPLACE_OPS) and MEDICAL_DIRECTOR (they see every patient
   * in their practice), but tightens a plain PROVIDER to ASSIGNED patients
   * only: the ones where they are the primary OR backup provider on the
   * assignment row.
   *
   * Manisha 2026-06 sign-off (Humaira HIPAA N14 follow-up): practice-wide
   * read + act on the patient list / detail, but the dashboard queue is a
   * focused caseload, not a directory. See docs/ACCESS_SCOPE.md.
   *
   * Reuse: every path except the plain-PROVIDER case delegates to
   * `patientScopeFilter()`, so the two methods can never drift for the
   * org-wide / MED_DIR / defensive-deny branches.
   */
  async alertQueueScopeFilter(
    actor: ActorUser,
  ): Promise<{ providerAssignmentAsPatient: Record<string, unknown> } | undefined> {
    // Only a plain PROVIDER gets the tighter assigned-only queue. A MED_DIR
    // (even one who also holds PROVIDER) and the org-wide roles keep their
    // normal patient scope — delegate so those branches live in one place.
    const providerOnly =
      actor.roles.includes(UserRole.PROVIDER) &&
      !actor.roles.includes(UserRole.MEDICAL_DIRECTOR) &&
      !this.isUnscoped(actor)
    if (!providerOnly) return this.patientScopeFilter(actor)

    const practiceIds = this.scopeToActive(
      actor,
      await this.practicesForProvider(actor.id),
    )
    return {
      providerAssignmentAsPatient: {
        is: {
          OR: [
            { primaryProviderId: actor.id },
            { backupProviderId: actor.id },
          ],
          // Keep the active-practice scope so a multi-practice provider who
          // switched practices doesn't see stale alerts from the other
          // practice's assignment rows.
          practiceId: { in: practiceIds },
        },
      },
    }
  }

  /**
   * Practice-management write guard (config edit + staff-membership CRUD) for
   * `practice.controller.ts`. OPS / SUPER are unscoped; MEDICAL_DIRECTOR must
   * head the target practice (PracticeMedicalDirector). Any other role → 403.
   * The controller-level @Roles already limits the route to SUPER / OPS /
   * MED_DIR — this enforces the per-practice cell for a MED_DIR so they can
   * only manage practices they head, not any practice in the org. (2026-07-01)
   */
  async assertCanManagePractice(
    actor: ActorUser,
    practiceId: string,
  ): Promise<void> {
    if (this.isUnscoped(actor)) return
    if (
      actor.roles.includes(UserRole.MEDICAL_DIRECTOR) &&
      (await this.medHeadsPractice(actor.id, practiceId))
    ) {
      return
    }
    this.denyLog('practice-management', practiceId, actor.id)
    throw new ForbiddenException(
      'Requested record is outside your management scope',
    )
  }

  private isUnscoped(actor: ActorUser): boolean {
    return (
      actor.roles.includes(UserRole.SUPER_ADMIN) ||
      actor.roles.includes(UserRole.HEALPLACE_OPS)
    )
  }

  /**
   * Phase/practice-identity strict scoping (Duwaragie 2026-06-19) — narrow
   * a membership list to the single active practice when the session
   * carries one. Multi-practice providers must explicitly switch to see
   * another practice's patients; single-practice users no-op (their active
   * id equals their only membership). No active context (legacy session
   * issued before the JWT carried the claim) → full membership list.
   *
   * Stale-claim guard: an `activePracticeId` that is NOT in the membership
   * list is ignored — we only ever narrow WITHIN the list, never widen to a
   * practice the user isn't a member of via a forged/stale JWT claim.
   */
  private scopeToActive(actor: ActorUser, practiceIds: string[]): string[] {
    return actor.activePracticeId && practiceIds.includes(actor.activePracticeId)
      ? [actor.activePracticeId]
      : practiceIds
  }

  /**
   * Per-patient analog of `scopeToActive` for the assert path. True when the
   * patient's practice is visible under the actor's active context: either
   * the session has no active context (legacy/union) or the patient's
   * practice IS the active one.
   */
  private inActiveScope(actor: ActorUser, practiceId: string): boolean {
    return !actor.activePracticeId || actor.activePracticeId === practiceId
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

  private async providerInPractice(
    userId: string,
    practiceId: string,
  ): Promise<boolean> {
    const row = await this.prisma.practiceProvider.findUnique({
      where: { practiceId_userId: { practiceId, userId } },
      select: { id: true },
    })
    return row !== null
  }

  private async practicesForProvider(userId: string): Promise<string[]> {
    const rows = await this.prisma.practiceProvider.findMany({
      where: { userId },
      select: { practiceId: true },
    })
    return rows.map((r) => r.practiceId)
  }

  /**
   * Practice IDs the actor can SEE in the /practices list. Mirrors the
   * patient list scoping: OPS/SUPER see all (returns undefined =
   * no filter), MED_DIR sees their PracticeMedicalDirector memberships,
   * PROVIDER sees their PracticeProvider memberships.
   *
   * Returns undefined when no filter should apply, or an array of allowed
   * practice IDs. An empty array means "no practices visible" — callers
   * should pass that through to Prisma as `{ id: { in: [] } }` so the
   * query returns zero rows rather than all rows.
   */
  async practiceScopeIds(actor: ActorUser): Promise<string[] | undefined> {
    if (this.isUnscoped(actor)) return undefined

    const ids = new Set<string>()

    if (actor.roles.includes(UserRole.MEDICAL_DIRECTOR)) {
      const md = await this.prisma.practiceMedicalDirector.findMany({
        where: { userId: actor.id },
        select: { practiceId: true },
      })
      for (const r of md) ids.add(r.practiceId)
    }

    if (actor.roles.includes(UserRole.PROVIDER)) {
      const pp = await this.prisma.practiceProvider.findMany({
        where: { userId: actor.id },
        select: { practiceId: true },
      })
      for (const r of pp) ids.add(r.practiceId)
    }

    if (actor.roles.includes(UserRole.COORDINATOR)) {
      // A coordinator staffs exactly one practice (PracticeCoordinator @unique).
      // Read-only visibility into that practice (detail + staff list); they
      // never get the clinical patient surfaces (those stay role-gated).
      const coord = await this.prisma.practiceCoordinator.findUnique({
        where: { userId: actor.id },
        select: { practiceId: true },
      })
      if (coord) ids.add(coord.practiceId)
    }

    return Array.from(ids)
  }
}
