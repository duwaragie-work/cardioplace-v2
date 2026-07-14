import { jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'
import { CoordinatorService } from './coordinator.service.js'

// Pure-unit: PrismaService fully mocked. Covers practice resolution + the
// minimum-necessary shape of the coordinator patient / clinician lists.

function makeService() {
  const prisma: Record<string, any> = {
    practiceCoordinator: { findUnique: jest.fn() as jest.Mock<any> },
    user: { findMany: jest.fn() as jest.Mock<any> },
    practiceProvider: { findMany: jest.fn() as jest.Mock<any> },
    practiceMedicalDirector: { findMany: jest.fn() as jest.Mock<any> },
  }
  const svc = new CoordinatorService(prisma as any)
  return { svc, prisma }
}

describe('CoordinatorService', () => {
  it('throws when the caller is not assigned to a practice', async () => {
    const { svc, prisma } = makeService()
    prisma.practiceCoordinator.findUnique.mockResolvedValue(null)
    await expect(svc.listPatients('coord-1')).rejects.toThrow(ForbiddenException)
  })

  describe('listPatients', () => {
    it('scopes to the coordinator practice and returns minimum-necessary rows', async () => {
      const { svc, prisma } = makeService()
      prisma.practiceCoordinator.findUnique.mockResolvedValue({
        practiceId: 'p-cedar',
      })
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'pat-1',
          name: 'Aisha',
          email: 'a@test',
          displayId: 'CP1',
          onboardingStatus: 'COMPLETED',
          enrollmentStatus: 'ENROLLED',
          providerAssignmentAsPatient: {
            primaryProvider: { id: 'prov-1', name: 'Sam' },
            backupProvider: { id: 'prov-2', name: 'Elena' },
            medicalDirector: { id: 'md-1', name: 'Priya' },
          },
        },
        {
          id: 'pat-2',
          name: 'Bob',
          email: 'b@test',
          displayId: 'CP2',
          onboardingStatus: 'NOT_COMPLETED',
          enrollmentStatus: 'NOT_ENROLLED',
          providerAssignmentAsPatient: null,
        },
      ])

      const res = await svc.listPatients('coord-1')

      // Practice-scoped query (assigned OR invited into the practice), no CLOSED.
      const where = prisma.user.findMany.mock.calls[0][0].where
      expect(where.accountStatus).toEqual({ not: 'CLOSED' })
      expect(where.OR).toEqual([
        { providerAssignmentAsPatient: { is: { practiceId: 'p-cedar' } } },
        { userInviteCreated: { is: { practiceId: 'p-cedar' } } },
      ])

      // No clinical fields selected — only identity/onboarding + care team.
      const select = prisma.user.findMany.mock.calls[0][0].select
      expect(select).not.toHaveProperty('deviationAlerts')
      expect(select).not.toHaveProperty('journalEntries')
      expect(select).not.toHaveProperty('patientThreshold')

      expect(res.practiceId).toBe('p-cedar')
      expect(res.data[0].careTeam?.primaryProvider).toEqual({ id: 'prov-1', name: 'Sam' })
      expect(res.data[1].careTeam).toBeNull()
    })
  })

  describe('listClinicians', () => {
    it('returns the practice providers + medical directors, de-duplicated', async () => {
      const { svc, prisma } = makeService()
      prisma.practiceCoordinator.findUnique.mockResolvedValue({
        practiceId: 'p-cedar',
      })
      // prov-1 is both a provider AND a medical director → must appear once.
      prisma.practiceProvider.findMany.mockResolvedValue([
        { userId: 'prov-1' },
        { userId: 'prov-2' },
      ])
      prisma.practiceMedicalDirector.findMany.mockResolvedValue([
        { userId: 'prov-1' },
        { userId: 'md-1' },
      ])
      prisma.user.findMany.mockResolvedValue([
        { id: 'prov-1', name: 'Sam', email: 's@test', roles: ['PROVIDER', 'MEDICAL_DIRECTOR'] },
        { id: 'prov-2', name: 'Elena', email: 'e@test', roles: ['PROVIDER'] },
        { id: 'md-1', name: 'Priya', email: 'p@test', roles: ['MEDICAL_DIRECTOR'] },
      ])

      const res = await svc.listClinicians('coord-1')

      const ids = prisma.user.findMany.mock.calls[0][0].where.id.in
      expect([...ids].sort()).toEqual(['md-1', 'prov-1', 'prov-2'])
      expect(res.data).toHaveLength(3)
    })
  })
})
