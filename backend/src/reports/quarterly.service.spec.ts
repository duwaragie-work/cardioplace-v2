import { jest } from '@jest/globals'
import { QUARTERLY_RULES } from '@cardioplace/shared'
import { QuarterlyService, quarterMonths } from './quarterly.service.js'

// ReportsService double — compute() is looped per month for alert volume.
function makeReports(alertsPerMonth: number[]) {
  let call = 0
  return {
    compute: jest.fn(async () => ({
      overall: { totalAlerts: alertsPerMonth[call++] ?? 0 },
    })),
  } as any
}

function makePrisma(opts: {
  assignments?: Array<{ userId: string; user: { name: string | null; email: string | null } }>
  entries?: Array<{ userId: string; systolicBP: number | null; diastolicBP: number | null }>
  thresholds?: Array<{ userId: string; sbpUpperTarget: number | null; dbpUpperTarget: number | null }>
}) {
  return {
    patientProviderAssignment: { findMany: jest.fn(async () => opts.assignments ?? []) },
    journalEntry: { findMany: jest.fn(async () => opts.entries ?? []) },
    patientThreshold: { findMany: jest.fn(async () => opts.thresholds ?? []) },
  } as any
}

const practice = {
  id: 'prac-1',
  name: 'Cedar Hill',
  businessHoursTimezone: 'America/New_York',
}

describe('quarterMonths', () => {
  it('expands a quarter into its three months', () => {
    expect(quarterMonths('2026-Q1')).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(quarterMonths('2026-Q2')).toEqual(['2026-04', '2026-05', '2026-06'])
    expect(quarterMonths('2026-Q4')).toEqual(['2026-10', '2026-11', '2026-12'])
  })
})

describe('QuarterlyService.compute', () => {
  it('builds the alert-volume trend from per-month compute()', async () => {
    const svc = new QuarterlyService(makePrisma({}), makeReports([5, 8, 2]))
    const report = await svc.compute(practice, '2026-Q2')
    expect(report.alertVolume.map((m) => m.totalAlerts)).toEqual([5, 8, 2])
    expect(report.alertVolume.map((m) => m.label)).toEqual([
      'Apr 2026', 'May 2026', 'Jun 2026',
    ])
    expect(report.totalAlertsInQuarter).toBe(15)
  })

  it('marks a patient controlled when quarter-average BP is at/below default target', async () => {
    expect(QUARTERLY_RULES.defaultSbpUpper).toBe(140)
    const prisma = makePrisma({
      assignments: [{ userId: 'a', user: { name: 'Alice', email: null } }],
      entries: [
        { userId: 'a', systolicBP: 130, diastolicBP: 80 },
        { userId: 'a', systolicBP: 138, diastolicBP: 86 }, // avg 134/83
      ],
    })
    const svc = new QuarterlyService(prisma, makeReports([0, 0, 0]))
    const report = await svc.compute(practice, '2026-Q2')
    const alice = report.byPatient[0]
    expect(alice.meanSystolic).toBe(134)
    expect(alice.meanDiastolic).toBe(83)
    expect(alice.status).toBe('CONTROLLED')
    expect(alice.usedCustomTarget).toBe(false)
    expect(report.control.controlRatePct).toBe(100)
  })

  it('marks a patient not-controlled when average exceeds target', async () => {
    const prisma = makePrisma({
      assignments: [{ userId: 'b', user: { name: 'Bob', email: null } }],
      entries: [
        { userId: 'b', systolicBP: 150, diastolicBP: 95 },
        { userId: 'b', systolicBP: 160, diastolicBP: 100 }, // avg 155/98
      ],
    })
    const svc = new QuarterlyService(prisma, makeReports([0, 0, 0]))
    const report = await svc.compute(practice, '2026-Q2')
    expect(report.byPatient[0].status).toBe('NOT_CONTROLLED')
    expect(report.control.controlRatePct).toBe(0)
  })

  it('uses a provider-set PatientThreshold instead of the default', async () => {
    const prisma = makePrisma({
      assignments: [{ userId: 'c', user: { name: 'Carol', email: null } }],
      entries: [{ userId: 'c', systolicBP: 132, diastolicBP: 84 }],
      // Stricter provider target: 130/80 → 132/84 is NOT controlled.
      thresholds: [{ userId: 'c', sbpUpperTarget: 130, dbpUpperTarget: 80 }],
    })
    const svc = new QuarterlyService(prisma, makeReports([0, 0, 0]))
    const report = await svc.compute(practice, '2026-Q2')
    const carol = report.byPatient[0]
    expect(carol.sbpUpper).toBe(130)
    expect(carol.usedCustomTarget).toBe(true)
    expect(carol.status).toBe('NOT_CONTROLLED')
  })

  it('computes the control rate across a mixed roster', async () => {
    const prisma = makePrisma({
      assignments: [
        { userId: 'a', user: { name: 'Alice', email: null } },
        { userId: 'b', user: { name: 'Bob', email: null } },
        { userId: 'c', user: { name: 'Carol', email: null } },
        // 'd' has no readings → excluded from the rate.
        { userId: 'd', user: { name: 'Dan', email: null } },
      ],
      entries: [
        { userId: 'a', systolicBP: 120, diastolicBP: 78 }, // controlled
        { userId: 'b', systolicBP: 122, diastolicBP: 79 }, // controlled
        { userId: 'c', systolicBP: 165, diastolicBP: 99 }, // not
      ],
    })
    const svc = new QuarterlyService(prisma, makeReports([0, 0, 0]))
    const report = await svc.compute(practice, '2026-Q2')
    expect(report.control.patientsWithReadings).toBe(3)
    expect(report.control.controlled).toBe(2)
    expect(report.control.controlRatePct).toBe(66.67) // 2/3
    // Worst-first ordering: not-controlled at the top.
    expect(report.byPatient[0].status).toBe('NOT_CONTROLLED')
  })
})
