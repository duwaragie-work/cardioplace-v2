// Chunk C — boundary tests for the client-side delay-band predictor. Mirrors
// the backend computeDelayBand spec (daily_journal.service.spec.ts) so the
// pre-submit DELAYED warning fires on exactly the same 5min/1h/24h cutoffs.
import { delayBandFor } from './delayBand'

describe('delayBandFor', () => {
  const now = new Date('2026-06-09T12:00:00Z').getTime()
  const min = 60 * 1000
  const hour = 60 * min

  it('same instant -> REAL_TIME', () => {
    expect(delayBandFor(now, now)).toBe('REAL_TIME')
  })
  it('4 min ago -> REAL_TIME (just under 5 min)', () => {
    expect(delayBandFor(now - 4 * min, now)).toBe('REAL_TIME')
  })
  it('5 min ago -> NEAR_REAL_TIME (boundary)', () => {
    expect(delayBandFor(now - 5 * min, now)).toBe('NEAR_REAL_TIME')
  })
  it('45 min ago -> NEAR_REAL_TIME', () => {
    expect(delayBandFor(now - 45 * min, now)).toBe('NEAR_REAL_TIME')
  })
  it('1 h ago -> DELAYED_ENTRY (boundary)', () => {
    expect(delayBandFor(now - hour, now)).toBe('DELAYED_ENTRY')
  })
  it('6 h ago -> DELAYED_ENTRY', () => {
    expect(delayBandFor(now - 6 * hour, now)).toBe('DELAYED_ENTRY')
  })
  it('23h59m ago -> DELAYED_ENTRY (just under 24 h)', () => {
    expect(delayBandFor(now - (24 * hour - min), now)).toBe('DELAYED_ENTRY')
  })
  it('24 h ago -> HISTORICAL_ENTRY (boundary)', () => {
    expect(delayBandFor(now - 24 * hour, now)).toBe('HISTORICAL_ENTRY')
  })
  it('7 days ago -> HISTORICAL_ENTRY', () => {
    expect(delayBandFor(now - 7 * 24 * hour, now)).toBe('HISTORICAL_ENTRY')
  })
  it('30 s in the future -> REAL_TIME (clock skew)', () => {
    expect(delayBandFor(now + 30 * 1000, now)).toBe('REAL_TIME')
  })
})
