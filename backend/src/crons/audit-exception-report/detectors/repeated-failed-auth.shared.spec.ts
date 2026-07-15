import {
  aggregateFailedAuth,
  failedAuthWhere,
  FAILURE_THRESHOLD,
  CRITICAL_ESCALATION_THRESHOLD,
  DEV_OTP_IDENTIFIER,
  type FailedAuthRow,
} from './repeated-failed-auth.shared.js'

/**
 * Direct edge-case coverage for the shared aggregation used by BOTH the daily
 * batch detector and the real-time evaluator. Keeping this exhaustive is what
 * lets the two paths stay in lockstep — if the grouping/threshold/severity
 * logic drifts, one of these breaks.
 */

const ANCHOR = Date.parse('2026-07-15T12:00:00Z')

function row(
  identifier: string | null,
  minutesAgo: number,
  extra: Partial<FailedAuthRow> = {},
): FailedAuthRow {
  // NB: use `in` checks, not `??`, so an explicit `null` (e.g. ipAddress: null)
  // is honoured rather than being clobbered back to the default.
  return {
    identifier,
    userId: 'userId' in extra ? (extra.userId ?? null) : null,
    ipAddress: 'ipAddress' in extra ? (extra.ipAddress ?? null) : '10.0.0.1',
    event: extra.event ?? 'otp_failed',
    errorCode: extra.errorCode ?? null,
    practiceContext: 'practiceContext' in extra ? (extra.practiceContext ?? null) : null,
    createdAt: new Date(ANCHOR - minutesAgo * 60_000),
  }
}

const rows = (id: string, n: number, extra: Partial<FailedAuthRow> = {}) =>
  Array.from({ length: n }, (_, i) => row(id, i, extra))

describe('aggregateFailedAuth — thresholds', () => {
  it('empty input → no candidates', () => {
    expect(aggregateFailedAuth([])).toEqual([])
  })

  it('below threshold (4) → no candidate', () => {
    expect(aggregateFailedAuth(rows('a@x.com', FAILURE_THRESHOLD - 1))).toEqual([])
  })

  it('exactly at threshold (5) → one HIGH candidate (no CRITICAL override)', () => {
    const [c] = aggregateFailedAuth(rows('a@x.com', FAILURE_THRESHOLD))
    expect(c).toBeDefined()
    expect(c.subjectKey).toBe('identifier:a@x.com')
    expect((c.evidence as any).failedCount).toBe(5)
    expect(c.severityOverride).toBeUndefined()
  })

  it('one below CRITICAL (49) → still HIGH', () => {
    const [c] = aggregateFailedAuth(rows('a@x.com', CRITICAL_ESCALATION_THRESHOLD - 1))
    expect(c.severityOverride).toBeUndefined()
  })

  it('exactly at CRITICAL (50) → severity override CRITICAL', () => {
    const [c] = aggregateFailedAuth(rows('a@x.com', CRITICAL_ESCALATION_THRESHOLD))
    expect(c.severityOverride).toBe('CRITICAL')
    expect((c.evidence as any).failedCount).toBe(50)
  })
})

describe('aggregateFailedAuth — grouping', () => {
  it('groups by identifier; only those ≥5 fire', () => {
    const out = aggregateFailedAuth([
      ...rows('fires@x.com', 6),
      ...rows('quiet@x.com', 2), // below threshold — excluded
    ])
    expect(out).toHaveLength(1)
    expect(out[0].subjectKey).toBe('identifier:fires@x.com')
  })

  it('emits a candidate per identifier when several cross the threshold', () => {
    const out = aggregateFailedAuth([...rows('a@x.com', 5), ...rows('b@x.com', 7)])
    expect(out.map((c) => c.subjectKey).sort()).toEqual([
      'identifier:a@x.com',
      'identifier:b@x.com',
    ])
  })

  it('skips rows with a null identifier (cannot key a subject on null)', () => {
    const out = aggregateFailedAuth([
      ...rows('a@x.com', 5),
      ...Array.from({ length: 10 }, (_, i) => row(null, i)),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].subjectKey).toBe('identifier:a@x.com')
  })
})

describe('aggregateFailedAuth — evidence', () => {
  it('counts distinct IPs and userIds, and breaks down by event', () => {
    const [c] = aggregateFailedAuth([
      row('a@x.com', 0, { ipAddress: '1.1.1.1', userId: 'u1', event: 'otp_failed' }),
      row('a@x.com', 1, { ipAddress: '2.2.2.2', userId: 'u1', event: 'otp_failed' }),
      row('a@x.com', 2, { ipAddress: '2.2.2.2', userId: 'u2', event: 'mfa_challenge_failed' }),
      row('a@x.com', 3, { ipAddress: '3.3.3.3', userId: null, event: 'otp_failed' }),
      row('a@x.com', 4, { ipAddress: null, userId: null, event: 'otp_failed' }),
    ])
    const e = c.evidence as any
    expect(e.distinctIpCount).toBe(3) // 1.1, 2.2, 3.3 (null not counted)
    expect(e.distinctUserIds.sort()).toEqual(['u1', 'u2'])
    expect(e.eventBreakdown).toEqual({ otp_failed: 4, mfa_challenge_failed: 1 })
  })

  it('firstFailAt / lastFailAt are correct even when input is UNSORTED', () => {
    // Deliberately out of order — the aggregation must sort internally so the
    // real-time path (which may not pre-sort) matches the batch path.
    const [c] = aggregateFailedAuth([
      row('a@x.com', 2),
      row('a@x.com', 0), // newest
      row('a@x.com', 10), // oldest
      row('a@x.com', 5),
      row('a@x.com', 1),
    ])
    const e = c.evidence as any
    expect(e.firstFailAt).toBe(new Date(ANCHOR - 10 * 60_000).toISOString())
    expect(e.lastFailAt).toBe(new Date(ANCHOR - 0 * 60_000).toISOString())
  })

  it('practiceContext = the most common non-null value', () => {
    const [c] = aggregateFailedAuth([
      row('a@x.com', 0, { practiceContext: 'p-A' }),
      row('a@x.com', 1, { practiceContext: 'p-B' }),
      row('a@x.com', 2, { practiceContext: 'p-A' }),
      row('a@x.com', 3, { practiceContext: null }),
      row('a@x.com', 4, { practiceContext: 'p-A' }),
    ])
    expect(c.practiceContext).toBe('p-A')
  })

  it('practiceContext = null when no row carried one', () => {
    const [c] = aggregateFailedAuth(rows('a@x.com', 5))
    expect(c.practiceContext).toBeNull()
  })
})

describe('failedAuthWhere', () => {
  const start = new Date('2026-07-14T12:00:00Z')
  const end = new Date('2026-07-15T12:00:00Z')

  it('constrains success:false in the window, non-null identifier, dev-OTP excluded', () => {
    expect(failedAuthWhere(start, end)).toEqual({
      success: false,
      createdAt: { gte: start, lt: end },
      identifier: { not: null },
      NOT: { identifier: DEV_OTP_IDENTIFIER },
    })
  })

  it('the excluded identifier is the dev perma-OTP', () => {
    expect(DEV_OTP_IDENTIFIER).toBe('666666')
  })
})
