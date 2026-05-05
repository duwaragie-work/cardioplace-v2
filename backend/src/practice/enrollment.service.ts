import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { EnrollmentStatus } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { EscalationService } from '../daily_journal/services/escalation.service.js'
import { canCompleteEnrollment } from './enrollment-gate.js'

@Injectable()
export class EnrollmentService {
  private readonly logger = new Logger(EnrollmentService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly escalation: EscalationService,
  ) {}

  async completeEnrollment(adminId: string, patientUserId: string) {
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

    const updated = await this.prisma.user.update({
      where: { id: patientUserId },
      data: { enrollmentStatus: EnrollmentStatus.ENROLLED },
      select: { id: true, enrollmentStatus: true },
    })

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
        completedBy: adminId,
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
}
