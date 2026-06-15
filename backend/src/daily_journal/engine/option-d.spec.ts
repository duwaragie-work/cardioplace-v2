// Option D decision (Manisha 2026-06-12 Q2). Decides EMERGENCY vs
// CONFIRMED_NORMAL from the confirmatory reading's OWN band, not the average.
import { decideOptionDOutcome } from './option-d.js'

describe('decideOptionDOutcome — RULE_UNCONFIRMED_EMERGENCY / RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL gate', () => {
  it('second reading still ≥180 systolic → EMERGENCY', () => {
    expect(decideOptionDOutcome(185, 110)).toBe('EMERGENCY')
  })

  it('second reading ≥120 diastolic → EMERGENCY', () => {
    expect(decideOptionDOutcome(170, 122)).toBe('EMERGENCY')
  })

  it('boundary 180/120 → EMERGENCY (inclusive, matches absoluteEmergencyRule)', () => {
    expect(decideOptionDOutcome(180, 120)).toBe('EMERGENCY')
  })

  it('second reading below both thresholds → CONFIRMED_NORMAL', () => {
    expect(decideOptionDOutcome(135, 85)).toBe('CONFIRMED_NORMAL')
  })

  it('the load-bearing case: 178/118 confirmatory → CONFIRMED_NORMAL even though a 195/120+178/118 average would read emergency', () => {
    expect(decideOptionDOutcome(178, 118)).toBe('CONFIRMED_NORMAL')
  })

  it('just under each threshold → CONFIRMED_NORMAL', () => {
    expect(decideOptionDOutcome(179, 119)).toBe('CONFIRMED_NORMAL')
  })

  it('null values → CONFIRMED_NORMAL (no emergency without a measured value)', () => {
    expect(decideOptionDOutcome(null, null)).toBe('CONFIRMED_NORMAL')
  })
})
