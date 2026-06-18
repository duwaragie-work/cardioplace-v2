import { hasLargeDiscrepancy } from './option-d-discrepancy.js'

// Item B — the boundary is SBP delta ≥ 40 OR DBP delta ≥ 20 (absolute, either
// direction). These cases pin both edges so a future threshold tweak is a
// deliberate change, not an accident.

describe('hasLargeDiscrepancy', () => {
  it('SBP delta of exactly 40 → true (boundary, inclusive)', () => {
    expect(
      hasLargeDiscrepancy(
        { systolicBP: 180, diastolicBP: 100 },
        { systolicBP: 140, diastolicBP: 100 },
      ),
    ).toBe(true)
  })

  it('SBP delta of 39 → false (just under)', () => {
    expect(
      hasLargeDiscrepancy(
        { systolicBP: 179, diastolicBP: 100 },
        { systolicBP: 140, diastolicBP: 100 },
      ),
    ).toBe(false)
  })

  it('DBP delta of exactly 20 → true (boundary, inclusive)', () => {
    expect(
      hasLargeDiscrepancy(
        { systolicBP: 150, diastolicBP: 120 },
        { systolicBP: 150, diastolicBP: 100 },
      ),
    ).toBe(true)
  })

  it('DBP delta of 19 → false (just under)', () => {
    expect(
      hasLargeDiscrepancy(
        { systolicBP: 150, diastolicBP: 119 },
        { systolicBP: 150, diastolicBP: 100 },
      ),
    ).toBe(false)
  })

  it('both deltas small → false', () => {
    expect(
      hasLargeDiscrepancy(
        { systolicBP: 152, diastolicBP: 92 },
        { systolicBP: 150, diastolicBP: 90 },
      ),
    ).toBe(false)
  })

  it('195/120 → 145/85 (real episode-vs-spike example) → true', () => {
    expect(
      hasLargeDiscrepancy(
        { systolicBP: 195, diastolicBP: 120 },
        { systolicBP: 145, diastolicBP: 85 },
      ),
    ).toBe(true)
  })

  it('detects the delta regardless of direction (smaller → larger)', () => {
    expect(
      hasLargeDiscrepancy(
        { systolicBP: 140, diastolicBP: 85 },
        { systolicBP: 195, diastolicBP: 120 },
      ),
    ).toBe(true)
  })
})
