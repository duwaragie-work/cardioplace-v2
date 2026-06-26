import {
  TIER_RESOLVE_SLA_MINUTES,
  TIER_SLA_MINUTES,
  type MonthlyReport,
} from '@cardioplace/shared'
import { SlaService } from './sla.service.js'

function svc() {
  return new SlaService({} as any, {} as any)
}

function tierRow(over: Partial<MonthlyReport['byTier'][number]>) {
  return {
    tier: 'BP_LEVEL_2' as const,
    total: 0,
    acknowledgedInWindow: 0,
    escalated: 0,
    resolved: 0,
    meanAckSeconds: null,
    meanResolveSeconds: null,
    ...over,
  }
}

function monthly(byTier: MonthlyReport['byTier']): MonthlyReport {
  return {
    practiceId: 'p1',
    practiceName: 'Cedar Hill',
    monthYear: '2026-05',
    windowStart: '2026-05-01T00:00:00.000Z',
    windowEnd: '2026-06-01T00:00:00.000Z',
    practiceTimezone: 'America/New_York',
    generatedAt: '2026-06-01T00:00:00.000Z',
    cached: false,
    overall: {
      totalAlerts: 0,
      acknowledgedInWindow: 0,
      acknowledgedInWindowPct: 0,
      escalated: 0,
      escalatedPct: 0,
      resolved: 0,
      resolvedPct: 0,
      meanAckSeconds: null,
      meanResolveSeconds: null,
      totalPatients: 0,
    },
    byTier,
    byProvider: [],
  }
}

describe('SlaService.fromMonthly', () => {
  it('passes when the mean is at/below target, fails when over', () => {
    const ackTarget = TIER_SLA_MINUTES.BP_LEVEL_2 * 60 // 15 min → 900 s
    const resolveTarget = TIER_RESOLVE_SLA_MINUTES.BP_LEVEL_2 * 60 // 60 min
    const report = svc().fromMonthly(
      monthly([
        tierRow({
          tier: 'BP_LEVEL_2',
          total: 4,
          acknowledgedInWindow: 3,
          meanAckSeconds: ackTarget - 60, // under → pass
          meanResolveSeconds: resolveTarget + 600, // over → fail
        }),
      ]),
    )
    const row = report.byTier.find((r) => r.tier === 'BP_LEVEL_2')!
    expect(row.ackPass).toBe(true)
    expect(row.resolvePass).toBe(false)
    expect(row.ackWithinPct).toBe(75) // 3 of 4
    expect(report.tiersFailing).toBe(1)
    expect(report.provisional).toBe(true)
  })

  it('reports no-data (null) verdicts when nothing was acked/resolved', () => {
    const report = svc().fromMonthly(
      monthly([
        tierRow({
          tier: 'TIER_3_INFO',
          total: 0,
          meanAckSeconds: null,
          meanResolveSeconds: null,
        }),
      ]),
    )
    const row = report.byTier.find((r) => r.tier === 'TIER_3_INFO')!
    expect(row.ackPass).toBeNull()
    expect(row.resolvePass).toBeNull()
    expect(row.ackWithinPct).toBeNull()
    expect(report.tiersFailing).toBe(0) // null is not a failure
  })

  it('carries the targets through in seconds', () => {
    const report = svc().fromMonthly(
      monthly([tierRow({ tier: 'BP_LEVEL_1_HIGH', total: 1, meanAckSeconds: 10 })]),
    )
    const row = report.byTier.find((r) => r.tier === 'BP_LEVEL_1_HIGH')!
    expect(row.ackTargetSeconds).toBe(TIER_SLA_MINUTES.BP_LEVEL_1_HIGH * 60)
    expect(row.resolveTargetSeconds).toBe(
      TIER_RESOLVE_SLA_MINUTES.BP_LEVEL_1_HIGH * 60,
    )
  })
})
