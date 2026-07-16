import {
  AuditExceptionDetectorId,
  AuditExceptionSeverity,
  AuditExceptionStatus,
  UserRole,
} from '../../../generated/prisma/enums.js'
import type {
  DetectorContext,
  ExceptionCandidate,
  ExceptionDetector,
} from '../detector.types.js'

/**
 * N7 detector — CROSS_PRACTICE_ACCESS.
 *
 * Fires when a USER actor touches a patient User row (via AccessLog
 * modelName='User') whose practice — read from PatientProviderAssignment —
 * does not intersect the actor's practice-membership set (union of
 * PracticeProvider, PracticeMedicalDirector, PracticeCoordinator).
 *
 * Whitelist (docs/ACCESS_SCOPE.md:34-45):
 *   • SUPER_ADMIN — unscoped by policy. Never fire.
 *   • MEDICAL_DIRECTOR — practice-scoped via PracticeMedicalDirector.
 *     Fire ONLY when the target's practice isn't in the MD's set.
 *   • HEALPLACE_OPS — cross-practice by design, BUT every action still
 *     needs justification. Fire and tag evidence.role='HEALPLACE_OPS' so
 *     triage can filter noise.
 *   • COORDINATOR — clinical-data access forbidden by policy. Fire and
 *     bump severity to CRITICAL — coordinator + PHI is a role-boundary
 *     violation.
 *   • PATIENT — reads own record; not applicable.
 *
 * Scope: only 'User' modelName is scanned in MVP. Other patient-keyed PHI
 * models (JournalEntry, DeviationAlert, PatientMedication…) use their own
 * row id as recordId, requiring a per-model join to reach patient User.id.
 * A follow-up iteration can extend; MVP captures the highest-signal case
 * (looking at a patient chart across a practice line).
 *
 * Severity: HIGH by default, CRITICAL for COORDINATOR + any clinical read.
 * One candidate per unique (actorId, targetPatientUserId) — repeated hits
 * on the same pair collapse to a single row for the reviewer.
 */
export class CrossPracticeAccessDetector implements ExceptionDetector {
  readonly id = AuditExceptionDetectorId.CROSS_PRACTICE_ACCESS
  readonly defaultSeverity = AuditExceptionSeverity.HIGH

  async scan(ctx: DetectorContext): Promise<ExceptionCandidate[]> {
    const rows = await ctx.prisma.accessLog.findMany({
      where: {
        action: 'READ',
        actorType: 'USER',
        actorId: { not: null },
        modelName: 'User',
        recordId: { not: null },
        createdAt: { gte: ctx.windowStart, lt: ctx.windowEnd },
      },
      select: {
        actorId: true,
        recordId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    if (rows.length === 0) return []

    // Collapse to unique (actor, target) pairs before the join fan-out.
    type Pair = { actorId: string; targetId: string; hits: number; firstAt: Date; lastAt: Date }
    const pairs = new Map<string, Pair>()
    for (const r of rows) {
      if (!r.actorId || !r.recordId) continue
      // Actor viewing their own row is not cross-practice.
      if (r.actorId === r.recordId) continue
      const key = `${r.actorId}::${r.recordId}`
      const existing = pairs.get(key)
      if (existing) {
        existing.hits++
        if (r.createdAt < existing.firstAt) existing.firstAt = r.createdAt
        if (r.createdAt > existing.lastAt) existing.lastAt = r.createdAt
      } else {
        pairs.set(key, {
          actorId: r.actorId,
          targetId: r.recordId,
          hits: 1,
          firstAt: r.createdAt,
          lastAt: r.createdAt,
        })
      }
    }
    if (pairs.size === 0) return []

    // Batch-load actor and target user metadata.
    const actorIds = new Set<string>()
    const targetIds = new Set<string>()
    for (const p of pairs.values()) {
      actorIds.add(p.actorId)
      targetIds.add(p.targetId)
    }

    const actors = await ctx.prisma.user.findMany({
      where: { id: { in: [...actorIds] } },
      select: {
        id: true,
        roles: true,
        practiceProviderMemberships: { select: { practiceId: true } },
        practiceMedicalDirectorMemberships: { select: { practiceId: true } },
        // PracticeCoordinator is singular (1:1) — a coordinator serves one practice.
        practiceCoordinator: { select: { practiceId: true } },
      },
    })
    const actorById = new Map(actors.map((a) => [a.id, a]))

    const targets = await ctx.prisma.user.findMany({
      where: { id: { in: [...targetIds] } },
      select: {
        id: true,
        roles: true,
        providerAssignmentAsPatient: { select: { practiceId: true } },
      },
    })
    const targetById = new Map(targets.map((t) => [t.id, t]))

    const out: ExceptionCandidate[] = []
    for (const p of pairs.values()) {
      const actor = actorById.get(p.actorId)
      const target = targetById.get(p.targetId)
      // Missing actor or target — user hard-deleted between the access and
      // the scan. Skip; the missing row is its own signal but not one this
      // detector meaningfully surfaces.
      if (!actor || !target) continue

      // SUPER_ADMIN: policy-unscoped. Never fire.
      if (actor.roles.includes(UserRole.SUPER_ADMIN)) continue

      // Only meaningful when the target is a patient — the User row for a
      // provider/MD is roster metadata, cross-practice access to which is
      // a different (weaker) signal.
      if (!target.roles.includes(UserRole.PATIENT)) continue

      const targetPractice = target.providerAssignmentAsPatient?.practiceId ?? null
      if (!targetPractice) continue // unassigned patient — no practice line to cross

      const actorPractices = new Set<string>([
        ...actor.practiceProviderMemberships.map((m) => m.practiceId),
        ...actor.practiceMedicalDirectorMemberships.map((m) => m.practiceId),
        // PracticeCoordinator is singular; may be null.
        ...(actor.practiceCoordinator ? [actor.practiceCoordinator.practiceId] : []),
      ])

      const isCoordinator = actor.roles.includes(UserRole.COORDINATOR)
      const isOps = actor.roles.includes(UserRole.HEALPLACE_OPS)

      // Coordinator touching a patient's User row is a role-boundary hit
      // regardless of practice — clinical data access is denied by policy
      // (ACCESS_SCOPE.md line 39).
      if (isCoordinator) {
        out.push(
          candidate(p, {
            role: 'COORDINATOR',
            reason: 'coordinator accessed patient PHI (no clinical scope)',
            actorPractices: [...actorPractices],
            targetPractice,
          }, AuditExceptionSeverity.CRITICAL, targetPractice),
        )
        continue
      }

      // Ops is cross-practice by design; still record the audit row so
      // HIPAA has the trail, but N-5 (Duwaragie 2026-07-14 triage) — file
      // the row as LOW severity + already-ACKNOWLEDGED so it never enters
      // the worklist's OPEN pane. Pre-fix, every ops access filed HIGH-open
      // and drowned the reviewer's queue with rubber-stamp work. See
      // ACCESS_SCOPE.md §5 ("HEALPLACE_OPS cross-practice visibility
      // intentionally") for the policy backing the auto-ack.
      if (isOps) {
        out.push(
          candidate(
            p,
            {
              role: 'HEALPLACE_OPS',
              reason:
                'ops accessed patient PHI (cross-practice by design; auto-acknowledged for compliance-trail retention)',
              actorPractices: [...actorPractices],
              targetPractice,
            },
            AuditExceptionSeverity.MEDIUM,
            targetPractice,
            AuditExceptionStatus.ACKNOWLEDGED,
          ),
        )
        continue
      }

      // PROVIDER / MEDICAL_DIRECTOR: fire only when the target's practice
      // is not in the actor's membership set.
      if (actorPractices.has(targetPractice)) continue
      out.push(
        candidate(p, {
          role: actor.roles.join(','),
          reason: "target patient's practice not in actor's practice memberships",
          actorPractices: [...actorPractices],
          targetPractice,
        }, undefined, targetPractice),
      )
    }
    return out
  }
}

function candidate(
  pair: { actorId: string; targetId: string; hits: number; firstAt: Date; lastAt: Date },
  extra: Record<string, unknown>,
  severityOverride: AuditExceptionSeverity | undefined,
  practiceContext: string,
  initialStatus?: AuditExceptionStatus,
): ExceptionCandidate {
  return {
    subjectKey: `actor:${pair.actorId}::target:${pair.targetId}`,
    summary: `Cross-practice access — actor ${pair.actorId} → patient ${pair.targetId} (${pair.hits} hit(s))`,
    evidence: {
      actorId: pair.actorId,
      targetPatientUserId: pair.targetId,
      hits: pair.hits,
      firstAt: pair.firstAt.toISOString(),
      lastAt: pair.lastAt.toISOString(),
      ...extra,
    },
    practiceContext,
    severityOverride,
    initialStatus,
  }
}
