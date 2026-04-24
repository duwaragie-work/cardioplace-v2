import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { EnrollmentStatus } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { canCompleteOnboarding } from './enrollment-gate.js'

@Injectable()
export class EnrollmentService {
  constructor(private readonly prisma: PrismaService) {}

  async completeOnboarding(adminId: string, patientUserId: string) {
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

    const gate = await canCompleteOnboarding(this.prisma, patientUserId)
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

    return {
      statusCode: 200,
      message: 'Patient enrolled',
      data: {
        userId: updated.id,
        enrollmentStatus: updated.enrollmentStatus,
        completedBy: adminId,
      },
    }
  }

  async check(patientUserId: string) {
    const result = await canCompleteOnboarding(this.prisma, patientUserId)
    return {
      statusCode: 200,
      message: result.ok ? 'Ready to enroll' : 'Prerequisites missing',
      data: result,
    }
  }
}
