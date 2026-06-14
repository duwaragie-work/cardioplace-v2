import { jest } from '@jest/globals'
import { ProviderService } from './provider.service.js'

// Manisha 2026-06-12 — getPatientSummary exposes `previouslyEnrolled` so the
// admin alert card can show the "threshold pending" badge (dispatch DID fire)
// instead of the "awaiting enrollment / no dispatch" badge for a patient who
// was auto-un-enrolled. Only queried when the patient is NOT_ENROLLED.

function makePrisma(over: {
  enrollmentStatus: string
  priorLog?: { id: string } | null
}) {
  const findFirst = jest.fn() as jest.Mock<any>
  findFirst.mockResolvedValue(over.priorLog ?? null)
  return {
    findFirst,
    prisma: {
      user: {
        findUnique: (jest.fn() as jest.Mock<any>).mockResolvedValue({
          id: 'p1',
          name: 'Aisha Johnson',
          email: 'aisha@example.com',
          dateOfBirth: new Date('1968-01-01T00:00:00Z'),
          communicationPreference: null,
          onboardingStatus: 'COMPLETED',
          enrollmentStatus: over.enrollmentStatus,
          patientProfile: null,
          journalEntries: [],
          deviationAlerts: [],
          escalationEvents: [],
        }),
      },
      journalEntry: {
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
      deviationAlert: {
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
      escalationEvent: {
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
      profileVerificationLog: { findFirst },
    },
  }
}

function makeService(prisma: any) {
  return new ProviderService(prisma, {} as any, {} as any)
}

describe('getPatientSummary — previouslyEnrolled', () => {
  it('ENROLLED patient → false, without querying the audit log', async () => {
    const { prisma, findFirst } = makePrisma({ enrollmentStatus: 'ENROLLED' })
    const res = await makeService(prisma).getPatientSummary('p1')
    expect(res.data.patient.previouslyEnrolled).toBe(false)
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('NOT_ENROLLED + prior enrollment audit row → true', async () => {
    const { prisma } = makePrisma({
      enrollmentStatus: 'NOT_ENROLLED',
      priorLog: { id: 'log-1' },
    })
    const res = await makeService(prisma).getPatientSummary('p1')
    expect(res.data.patient.previouslyEnrolled).toBe(true)
  })

  it('NOT_ENROLLED + no audit row (never enrolled) → false', async () => {
    const { prisma } = makePrisma({
      enrollmentStatus: 'NOT_ENROLLED',
      priorLog: null,
    })
    const res = await makeService(prisma).getPatientSummary('p1')
    expect(res.data.patient.previouslyEnrolled).toBe(false)
  })
})
