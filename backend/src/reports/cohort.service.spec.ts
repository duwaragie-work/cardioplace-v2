import { jest } from '@jest/globals'
import { CohortService } from './cohort.service.js'

function makePrisma(opts: {
  assignments?: Array<{ userId: string }>
  profiles?: Array<{
    userId: string
    hasHeartFailure: boolean
    heartFailureType: string
    hasCAD: boolean
    isPregnant: boolean
    profileVerificationStatus: string
  }>
  entries?: Array<{ userId: string; systolicBP: number | null; diastolicBP: number | null }>
  thresholds?: Array<{ userId: string; sbpUpperTarget: number | null; dbpUpperTarget: number | null }>
  alerts?: Array<{ userId: string }>
}) {
  return {
    patientProviderAssignment: { findMany: jest.fn(async () => opts.assignments ?? []) },
    patientProfile: { findMany: jest.fn(async () => opts.profiles ?? []) },
    journalEntry: { findMany: jest.fn(async () => opts.entries ?? []) },
    patientThreshold: { findMany: jest.fn(async () => opts.thresholds ?? []) },
    deviationAlert: { findMany: jest.fn(async () => opts.alerts ?? []) },
  } as any
}

const practice = { id: 'p1', name: 'Cedar Hill', businessHoursTimezone: 'America/New_York' }
const start = new Date('2026-05-01T00:00:00Z')
const end = new Date('2026-06-01T00:00:00Z')

function svc(prisma: any) {
  return new CohortService(prisma, {} as any)
}

function profile(userId: string, over: Partial<any> = {}) {
  return {
    userId,
    hasHeartFailure: false,
    heartFailureType: 'NOT_APPLICABLE',
    hasCAD: false,
    isPregnant: false,
    profileVerificationStatus: 'VERIFIED',
    ...over,
  }
}

const rowFor = (report: any, key: string) =>
  report.rows.find((r: any) => r.cohort === key)

describe('CohortService.compute', () => {
  it('counts a multi-condition patient in every cohort they belong to (overlap)', async () => {
    const prisma = makePrisma({
      assignments: [{ userId: 'a' }],
      profiles: [
        profile('a', { hasHeartFailure: true, heartFailureType: 'HFREF', hasCAD: true }),
      ],
    })
    const report = await svc(prisma).compute(practice, '2026-05', start, end)
    expect(rowFor(report, 'ALL').patientCount).toBe(1)
    expect(rowFor(report, 'HFREF').patientCount).toBe(1)
    expect(rowFor(report, 'CAD').patientCount).toBe(1)
    expect(rowFor(report, 'PREGNANCY').patientCount).toBe(0)
    expect(report.totalPatients).toBe(1)
  })

  it('only counts HFrEF when heartFailureType is HFREF', async () => {
    const prisma = makePrisma({
      assignments: [{ userId: 'a' }, { userId: 'b' }],
      profiles: [
        profile('a', { hasHeartFailure: true, heartFailureType: 'HFREF' }),
        profile('b', { hasHeartFailure: true, heartFailureType: 'HFPEF' }),
      ],
    })
    const report = await svc(prisma).compute(practice, '2026-05', start, end)
    expect(rowFor(report, 'HFREF').patientCount).toBe(1) // only 'a'
  })

  it('computes BP-control rate per cohort using the quarter-average', async () => {
    const prisma = makePrisma({
      assignments: [{ userId: 'a' }, { userId: 'b' }],
      profiles: [
        profile('a', { hasCAD: true }),
        profile('b', { hasCAD: true }),
      ],
      entries: [
        { userId: 'a', systolicBP: 130, diastolicBP: 80 }, // controlled
        { userId: 'b', systolicBP: 160, diastolicBP: 100 }, // not
      ],
    })
    const report = await svc(prisma).compute(practice, '2026-05', start, end)
    const cad = rowFor(report, 'CAD')
    expect(cad.patientsWithReadings).toBe(2)
    expect(cad.controlled).toBe(1)
    expect(cad.controlRatePct).toBe(50)
  })

  it('sums alerts and flags unverified profiles per cohort', async () => {
    const prisma = makePrisma({
      assignments: [{ userId: 'a' }, { userId: 'b' }],
      profiles: [
        profile('a', { isPregnant: true, profileVerificationStatus: 'UNVERIFIED' }),
        profile('b', { isPregnant: true, profileVerificationStatus: 'VERIFIED' }),
      ],
      alerts: [{ userId: 'a' }, { userId: 'a' }, { userId: 'b' }],
    })
    const report = await svc(prisma).compute(practice, '2026-05', start, end)
    const preg = rowFor(report, 'PREGNANCY')
    expect(preg.patientCount).toBe(2)
    expect(preg.alertCount).toBe(3)
    expect(preg.unverifiedProfiles).toBe(1)
  })

  it('returns an all-zero report for an empty roster', async () => {
    const report = await svc(makePrisma({})).compute(practice, '2026-05', start, end)
    expect(report.totalPatients).toBe(0)
    expect(rowFor(report, 'ALL').patientCount).toBe(0)
    expect(report.rows).toHaveLength(4)
  })
})
