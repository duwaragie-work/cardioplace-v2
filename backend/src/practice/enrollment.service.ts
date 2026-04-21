import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { OnboardingStatus } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { canCompleteOnboarding } from './enrollment-gate.js'

@Injectable()
export class EnrollmentService {
  constructor(private readonly prisma: PrismaService) {}

  async completeOnboarding(adminId: string, patientUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: patientUserId },
      select: { id: true, roles: true, onboardingStatus: true },
    })
    if (!user) throw new NotFoundException('Patient user not found')
    if (!user.roles.includes('PATIENT')) {
      throw new BadRequestException('User is not a PATIENT')
    }

    // Idempotent: already completed → 200 no-op (D1 decision).
    if (user.onboardingStatus === OnboardingStatus.COMPLETED) {
      return {
        statusCode: 200,
        message: 'Onboarding already completed',
        data: { userId: patientUserId, onboardingStatus: OnboardingStatus.COMPLETED },
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
      data: { onboardingStatus: OnboardingStatus.COMPLETED },
      select: { id: true, onboardingStatus: true },
    })

    return {
      statusCode: 200,
      message: 'Onboarding completed',
      data: {
        userId: updated.id,
        onboardingStatus: updated.onboardingStatus,
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
