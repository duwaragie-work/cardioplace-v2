import { ForbiddenException, Injectable } from '@nestjs/common'
import { UserRole } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'

/**
 * Coordinator (front-desk) patient surface. Minimum-necessary by design: a
 * coordinator sees only identity/onboarding fields + the current care team for
 * patients in THEIR practice — never clinical data (BP, alerts, thresholds).
 * Care-team assignment itself reuses the existing AssignmentService via the
 * `admin/patients/:userId/assignment` endpoints (now COORDINATOR-allowed).
 */
@Injectable()
export class CoordinatorService {
  constructor(private readonly prisma: PrismaService) {}

  /** The coordinator's own practice (PracticeCoordinator is 1:1 by userId). */
  private async practiceId(actorId: string): Promise<string> {
    const own = await this.prisma.practiceCoordinator.findUnique({
      where: { userId: actorId },
      select: { practiceId: true },
    })
    if (!own) {
      throw new ForbiddenException('You are not assigned to a practice')
    }
    return own.practiceId
  }

  /** Patients in the coordinator's practice (assigned OR invited into it). */
  async listPatients(actorId: string) {
    const practiceId = await this.practiceId(actorId)

    const patients = await this.prisma.user.findMany({
      where: {
        roles: { has: UserRole.PATIENT },
        accountStatus: { not: 'CLOSED' },
        OR: [
          { providerAssignmentAsPatient: { is: { practiceId } } },
          { userInviteCreated: { is: { practiceId } } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        displayId: true,
        onboardingStatus: true,
        enrollmentStatus: true,
        providerAssignmentAsPatient: {
          select: {
            primaryProvider: { select: { id: true, name: true } },
            backupProvider: { select: { id: true, name: true } },
            medicalDirector: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    })

    return {
      statusCode: 200,
      message: 'Patients retrieved',
      data: patients.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        displayId: p.displayId,
        onboardingStatus: p.onboardingStatus,
        enrollmentStatus: p.enrollmentStatus,
        careTeam: p.providerAssignmentAsPatient
          ? {
              primaryProvider: p.providerAssignmentAsPatient.primaryProvider,
              backupProvider: p.providerAssignmentAsPatient.backupProvider,
              medicalDirector: p.providerAssignmentAsPatient.medicalDirector,
            }
          : null,
      })),
      practiceId,
    }
  }

  /** Providers + medical directors who are members of the coordinator's
   *  practice — the pool the care-team dropdowns pick from. */
  async listClinicians(actorId: string) {
    const practiceId = await this.practiceId(actorId)

    const [providerRows, mdRows] = await Promise.all([
      this.prisma.practiceProvider.findMany({
        where: { practiceId },
        select: { userId: true },
      }),
      this.prisma.practiceMedicalDirector.findMany({
        where: { practiceId },
        select: { userId: true },
      }),
    ])
    const ids = [
      ...new Set([
        ...providerRows.map((r) => r.userId),
        ...mdRows.map((r) => r.userId),
      ]),
    ]

    const clinicians = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true, roles: true },
      orderBy: { name: 'asc' },
    })

    return {
      statusCode: 200,
      message: 'Clinicians retrieved',
      data: clinicians,
      practiceId,
    }
  }
}
