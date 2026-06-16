import { bucketReadingsBySession } from './readingsSession'

// Bug 14 — the patient /readings grouping must mirror the admin ReadingsTab's
// strictness: proximity only ever groups two NULL-session rows; it must never
// bridge two different non-null sessionIds (e.g. a declined Option D emergency
// and a fresh reading minutes later).

const T0 = '2026-06-16T14:44:00.000Z'
const T3 = '2026-06-16T14:47:00.000Z' // +3 min (within the 5-min window)
const T9 = '2026-06-16T14:53:00.000Z' // +9 min (outside the window)

function entry(sessionId: string | null, measuredAt: string) {
  return { sessionId, measuredAt }
}

describe('bucketReadingsBySession (Bug 14)', () => {
  it('different non-null sessionIds within 5 min → 2 buckets (the bug)', () => {
    const buckets = bucketReadingsBySession([
      entry('sess-A', T3),
      entry('sess-B', T0),
    ])
    expect(buckets).toHaveLength(2)
    expect(buckets.map((b) => b.items.length)).toEqual([1, 1])
  })

  it('same non-null sessionId → 1 bucket', () => {
    const buckets = bucketReadingsBySession([
      entry('sess-A', T3),
      entry('sess-A', T0),
    ])
    expect(buckets).toHaveLength(1)
    expect(buckets[0]!.items).toHaveLength(2)
    expect(buckets[0]!.sessionId).toBe('sess-A')
  })

  it('both null sessionId within 5 min → 1 bucket (legacy fallback preserved)', () => {
    const buckets = bucketReadingsBySession([entry(null, T3), entry(null, T0)])
    expect(buckets).toHaveLength(1)
    expect(buckets[0]!.items).toHaveLength(2)
    expect(buckets[0]!.sessionId).toBeNull()
  })

  it('one null + one non-null sessionId → 2 buckets (never bridge the boundary)', () => {
    const buckets = bucketReadingsBySession([
      entry('sess-A', T3),
      entry(null, T0),
    ])
    expect(buckets).toHaveLength(2)
  })

  it('both null but > 5 min apart → 2 buckets (window still bounds the fallback)', () => {
    const buckets = bucketReadingsBySession([entry(null, T9), entry(null, T0)])
    expect(buckets).toHaveLength(2)
  })

  it('reproduces the live scenario: declined emergency + fresh reading 3 min later → 2 buckets', () => {
    // Both have distinct non-null sessionIds (backend anchors them separately);
    // pre-fix they proximity-merged into one "Avg 170/103" session card.
    const buckets = bucketReadingsBySession([
      { sessionId: 'ab5e2c97', measuredAt: T3 }, // fresh 145/85
      { sessionId: 'ccb7a0fa', measuredAt: T0 }, // declined 195/120 (UNCONFIRMED)
    ])
    expect(buckets).toHaveLength(2)
  })
})
