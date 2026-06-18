import { jest } from '@jest/globals'
import { ADHERENCE_RULES } from '@cardioplace/shared'
import { AdherenceService } from './adherence.service.js'

// Minimal Prisma double — only the three reads compute() makes. Each test
// sets the rows it wants returned. No DB, no auth (compute() is auth-free).
function makePrisma(opts: {
  assignments?: Array<{ userId: string; user: { name: string | null; email: string | null } }>
  meds?: Array<{ userId: string }>
  entries?: Array<{
    userId: string
    medicationTaken: boolean | null
    medicationScheduledLater: boolean
    missedDoses?: number | null
    missedMedications?: unknown
    medicationStatuses?: unknown
  }>
}) {
  return {
    patientProviderAssignment: {
      findMany: jest.fn(async () => opts.assignments ?? []),
    },
    patientMedication: {
      findMany: jest.fn(async () => opts.meds ?? []),
    },
    journalEntry: {
      findMany: jest.fn(async () => opts.entries ?? []),
    },
  } as any
}

const practice = {
  id: 'prac-1',
  name: 'Cedar Hill',
  businessHoursTimezone: 'America/New_York',
}
const start = new Date('2026-03-20T00:00:00Z')
const end = new Date('2026-06-18T00:00:00Z')

function svc(prisma: any) {
  // ReportsService dependency is unused by compute() — pass a stub.
  return new AdherenceService(prisma, {} as any)
}

describe('AdherenceService.compute', () => {
  it('returns an all-zero report when the roster is empty', async () => {
    const report = await svc(makePrisma({})).compute(practice, 90, start, end)
    expect(report.byPatient).toHaveLength(0)
    expect(report.overall.patientsWithMeds).toBe(0)
    expect(report.overall.practiceAdherencePct).toBeNull()
    expect(report.provisional).toBe(true)
  })

  it('counts only patients with active meds as the denominator', async () => {
    const prisma = makePrisma({
      assignments: [
        { userId: 'a', user: { name: 'Alice', email: null } },
        { userId: 'b', user: { name: 'Bob', email: null } },
      ],
      // Only Alice has an active med.
      meds: [{ userId: 'a' }],
      entries: [],
    })
    const report = await svc(prisma).compute(practice, 90, start, end)
    expect(report.overall.patientsWithMeds).toBe(1)
    // Alice present (NO_DATA, no check-ins); Bob excluded (no meds).
    expect(report.byPatient.map((r) => r.patientId)).toEqual(['a'])
    expect(report.byPatient[0].status).toBe('NO_DATA')
  })

  it('computes adherence % from due/taken check-ins', async () => {
    const prisma = makePrisma({
      assignments: [{ userId: 'a', user: { name: 'Alice', email: null } }],
      meds: [{ userId: 'a' }],
      entries: [
        { userId: 'a', medicationTaken: true, medicationScheduledLater: false, missedDoses: 0 },
        { userId: 'a', medicationTaken: true, medicationScheduledLater: false, missedDoses: 0 },
        { userId: 'a', medicationTaken: false, medicationScheduledLater: false, missedDoses: 1 },
        { userId: 'a', medicationTaken: true, medicationScheduledLater: false, missedDoses: 0 },
      ],
    })
    const report = await svc(prisma).compute(practice, 90, start, end)
    const alice = report.byPatient[0]
    expect(alice.dueCheckIns).toBe(4)
    expect(alice.takenCheckIns).toBe(3)
    expect(alice.adherencePct).toBe(75) // 3/4
    expect(alice.missedDosesTotal).toBe(1)
    // 75 < 80 target → below target.
    expect(alice.status).toBe('BELOW_TARGET')
    expect(report.overall.practiceAdherencePct).toBe(75)
    expect(report.overall.patientsBelowTarget).toBe(1)
  })

  it('excludes "not due yet" check-ins from the denominator (neutral)', async () => {
    expect(ADHERENCE_RULES.scheduledLaterCountsAsDue).toBe(false)
    const prisma = makePrisma({
      assignments: [{ userId: 'a', user: { name: 'Alice', email: null } }],
      meds: [{ userId: 'a' }],
      entries: [
        { userId: 'a', medicationTaken: true, medicationScheduledLater: false, missedDoses: 0 },
        // not-due-yet: must NOT count against her.
        { userId: 'a', medicationTaken: false, medicationScheduledLater: true, missedDoses: 0 },
        // unanswered med question: also excluded.
        { userId: 'a', medicationTaken: null, medicationScheduledLater: false, missedDoses: 0 },
      ],
    })
    const report = await svc(prisma).compute(practice, 90, start, end)
    const alice = report.byPatient[0]
    expect(alice.checkInsLogged).toBe(3)
    expect(alice.dueCheckIns).toBe(1)
    expect(alice.takenCheckIns).toBe(1)
    expect(alice.adherencePct).toBe(100)
    expect(alice.status).toBe('ON_TRACK')
  })

  it('sums per-medication missed-dose counts (not the legacy scalar)', async () => {
    const prisma = makePrisma({
      assignments: [{ userId: 'a', user: { name: 'Alice', email: null } }],
      meds: [{ userId: 'a' }],
      entries: [
        {
          userId: 'a',
          medicationTaken: false,
          medicationScheduledLater: false,
          // Legacy scalar would only show 1 — the real counts live per-med.
          missedDoses: 1,
          medicationStatuses: [
            { medicationId: 'm1', taken: 'no', missedDoses: 10 },
            { medicationId: 'm2', taken: 'no', missedDoses: 3 },
            { medicationId: 'm3', taken: 'yes' },
          ],
        },
      ],
    })
    const report = await svc(prisma).compute(practice, 90, start, end)
    expect(report.byPatient[0].missedDosesTotal).toBe(13) // 10 + 3, not 1
    expect(report.overall.totalMissedDoses).toBe(13)
  })

  it('falls back to missedMedications, then the scalar, for legacy rows', async () => {
    const prisma = makePrisma({
      assignments: [
        { userId: 'a', user: { name: 'Alice', email: null } },
        { userId: 'b', user: { name: 'Bob', email: null } },
      ],
      meds: [{ userId: 'a' }, { userId: 'b' }],
      entries: [
        {
          userId: 'a',
          medicationTaken: false,
          medicationScheduledLater: false,
          // No medicationStatuses → use the dedicated missed list.
          missedMedications: [{ missedDoses: 4 }, { missedDoses: 2 }],
        },
        {
          userId: 'b',
          medicationTaken: false,
          medicationScheduledLater: false,
          // Neither JSON field → legacy scalar.
          missedDoses: 5,
        },
      ],
    })
    const report = await svc(prisma).compute(practice, 90, start, end)
    const byId = Object.fromEntries(
      report.byPatient.map((r) => [r.patientId, r.missedDosesTotal]),
    )
    expect(byId.a).toBe(6) // 4 + 2
    expect(byId.b).toBe(5) // scalar fallback
  })

  it('sorts below-target patients first, no-data last', async () => {
    const prisma = makePrisma({
      assignments: [
        { userId: 'good', user: { name: 'Good', email: null } },
        { userId: 'bad', user: { name: 'Bad', email: null } },
        { userId: 'none', user: { name: 'None', email: null } },
      ],
      meds: [{ userId: 'good' }, { userId: 'bad' }, { userId: 'none' }],
      entries: [
        { userId: 'good', medicationTaken: true, medicationScheduledLater: false, missedDoses: 0 },
        { userId: 'bad', medicationTaken: false, medicationScheduledLater: false, missedDoses: 2 },
        // 'none' logs nothing → NO_DATA
      ],
    })
    const report = await svc(prisma).compute(practice, 90, start, end)
    expect(report.byPatient.map((r) => r.patientId)).toEqual(['bad', 'good', 'none'])
    expect(report.overall.patientsNoData).toBe(1)
    expect(report.overall.patientsReporting).toBe(2)
  })
})
