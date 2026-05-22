import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import {
  ActorUser,
  PatientAccessService,
} from '../common/patient-access.service.js'
import {
  EnrollmentStatus,
  VerifierRole,
  VerificationChangeType,
} from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { EscalationService } from '../daily_journal/services/escalation.service.js'
import { canCompleteEnrollment } from './enrollment-gate.js'

@Injectable()
export class EnrollmentService {
  private readonly logger = new Logger(EnrollmentService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly escalation: EscalationService,
    private readonly access: PatientAccessService,
  ) {}

  async completeEnrollment(actor: ActorUser, patientUserId: string) {
    // PROVIDER must be in panel; MED_DIR must head practice. Run before
    // any DB writes so a denied caller can't accidentally trigger the
    // enrollment audit row.
    await this.access.assertCanAccessPatient(actor, patientUserId)
    const user = await this.prisma.user.findUnique({
      where: { id: patientUserId },
      select: { id: true, roles: true, enrollmentStatus: true },
    })
    if (!user) throw new NotFoundException('Patient user not found')
    if (!user.roles.includes('PATIENT')) {
      throw new BadRequestException('User is not a PATIENT')
    }

    // Idempotent: already enrolled → 200 no-op.
    // Note: enrollmentStatus is orthogonal to onboardingStatus. The admin
    // endpoint owns enrollmentStatus; /v2/auth/profile owns onboardingStatus
    // (identity-only).
    if (user.enrollmentStatus === EnrollmentStatus.ENROLLED) {
      return {
        statusCode: 200,
        message: 'Patient already enrolled',
        data: {
          userId: patientUserId,
          enrollmentStatus: EnrollmentStatus.ENROLLED,
        },
      }
    }

    const gate = await canCompleteEnrollment(this.prisma, patientUserId)
    if (!gate.ok) {
      throw new ConflictException({
        message: 'Enrollment prerequisites missing',
        reasons: gate.reasons,
      })
    }

    // Cluster 8 — stamp enrolledAt on the first ENROLLED transition. The
    // idempotent early-return above means this only runs on the real flip;
    // drives the Q2 CAD-ramp "newly enrolled" check + Q3 first-month nudge.
    // Atomic with the audit row so the Timeline always reflects the activation
    // (manual enroll previously wrote NO log, so it was absent from the
    // Timeline while the IVR-04 auto revert/restore rows showed — inconsistent).
    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: patientUserId },
        data: {
          enrollmentStatus: EnrollmentStatus.ENROLLED,
          enrolledAt: new Date(),
        },
        select: { id: true, enrollmentStatus: true },
      }),
      this.prisma.profileVerificationLog.create({
        data: {
          userId: patientUserId,
          fieldPath: 'user.enrollmentStatus',
          previousValue: user.enrollmentStatus,
          newValue: EnrollmentStatus.ENROLLED,
          changedBy: actor.id,
          changedByRole: VerifierRole.ADMIN,
          changeType: VerificationChangeType.ADMIN_VERIFY,
          rationale: 'Enrollment completed by admin.',
        },
      }),
    ])

    // Catch-up: alerts that fired while this patient was un-enrolled were
    // deferred (DeviationAlert row written, no EscalationEvent). Now that
    // enrollment + provider assignment are in place, re-fire T+0 for any
    // such alert from the last 7 days. Best-effort: any failure is logged
    // but does not block the enrollment response — admins still get a 200
    // and can manually nudge stale alerts via Resolve if needed.
    let catchUp: { dispatched: number; skipped: number } = {
      dispatched: 0,
      skipped: 0,
    }
    try {
      catchUp = await this.escalation.dispatchDeferredForUser(patientUserId)
    } catch (err) {
      this.logger.error(
        `Catch-up dispatch failed for newly enrolled user ${patientUserId}`,
        err instanceof Error ? err.stack : err,
      )
    }

    return {
      statusCode: 200,
      message: 'Patient enrolled',
      data: {
        userId: updated.id,
        enrollmentStatus: updated.enrollmentStatus,
        completedBy: actor.id,
        catchUpDispatched: catchUp.dispatched,
        catchUpSkipped: catchUp.skipped,
      },
    }
  }

  async check(patientUserId: string) {
    const result = await canCompleteEnrollment(this.prisma, patientUserId)
    return {
      statusCode: 200,
      message: result.ok ? 'Ready to enroll' : 'Prerequisites missing',
      data: result,
    }
  }

  /**
   * IVR-04 completion — auto-restore enrollment for a patient who was
   * previously enrolled and then AUTO-REVERTED (a serious condition added
   * without a threshold), once the blocking prerequisite is resolved. Called
   * after a threshold is saved.
   *
   * A re-enroll is distinguished from a first-time enroll by the most recent
   * `user.enrollmentStatus` audit row being a revert to NOT_ENROLLED — the only
   * way an enrolled patient lands in NOT_ENROLLED. A never-enrolled patient has
   * no such log, so first-time enrollment stays a deliberate manual decision.
   * (We do NOT key off `enrolledAt`: the seed marks patients ENROLLED without
   * stamping it, so that signal misses every seeded patient.)
   *
   * Best-effort: never throws — on failure the patient stays NOT_ENROLLED and
   * the admin can enroll manually. Returns true when it re-enrolled.
   */
  async autoReEnrollIfGateCleared(
    actor: ActorUser,
    patientUserId: string,
  ): Promise<boolean> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: patientUserId },
        select: { enrollmentStatus: true },
      })
      if (!user || user.enrollmentStatus === EnrollmentStatus.ENROLLED) {
        return false
      }

      // Was this NOT_ENROLLED reached via a revert (vs. never enrolled)?
      const lastEnroll = await this.prisma.profileVerificationLog.findFirst({
        where: { userId: patientUserId, fieldPath: 'user.enrollmentStatus' },
        orderBy: { createdAt: 'desc' },
        select: { newValue: true },
      })
      if (lastEnroll?.newValue !== EnrollmentStatus.NOT_ENROLLED) return false

      const gate = await canCompleteEnrollment(this.prisma, patientUserId)
      if (!gate.ok) return false

      await this.prisma.user.update({
        where: { id: patientUserId },
        data: { enrollmentStatus: EnrollmentStatus.ENROLLED },
      })
      await this.prisma.profileVerificationLog.create({
        data: {
          userId: patientUserId,
          fieldPath: 'user.enrollmentStatus',
          previousValue: EnrollmentStatus.NOT_ENROLLED,
          newValue: EnrollmentStatus.ENROLLED,
          changedBy: actor.id,
          changedByRole: VerifierRole.ADMIN,
          changeType: VerificationChangeType.ADMIN_CORRECT,
          rationale:
            'Enrollment auto-restored — re-enrollment gate cleared after the blocking prerequisite was configured.',
        },
      })

      // Re-fire T+0 for alerts deferred while the patient was un-enrolled.
      try {
        await this.escalation.dispatchDeferredForUser(patientUserId)
      } catch (err) {
        this.logger.error(
          `Auto re-enroll catch-up dispatch failed for ${patientUserId}`,
          err instanceof Error ? err.stack : err,
        )
      }
      return true
    } catch (err) {
      this.logger.error(
        `Auto re-enroll failed for ${patientUserId}`,
        err instanceof Error ? err.stack : err,
      )
      return false
    }
  }
}
