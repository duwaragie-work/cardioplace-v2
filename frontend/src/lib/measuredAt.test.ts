import { isNowish, resolveMeasuredAtIso } from './measuredAt'

// Bug 15 — `<input type="time">` is minute-only, so building measuredAt from the
// form truncated to the minute and two same-minute submits collided on the DB
// unique constraint. resolveMeasuredAtIso uses real now() (full ms) for "just
// now" submissions and honors the chosen minute for genuinely backdated ones.
//
// All Dates below are constructed WITHOUT a trailing `Z`, so both the injected
// `now` and the form `date`+`time` parse in the same (local) zone — keeping the
// nowish comparison timezone-independent across CI machines.

describe('isNowish', () => {
  const now = new Date('2026-06-16T15:11:40.123').getTime()

  it('true when the chosen minute is within ~10 min of now', () => {
    expect(isNowish('2026-06-16', '15:11', now)).toBe(true)
  })

  it('false when the chosen time is well in the past (backdated)', () => {
    expect(isNowish('2026-06-16', '10:00', now)).toBe(false)
  })

  it('false for an unparseable date/time', () => {
    expect(isNowish('', '', now)).toBe(false)
  })
})

describe('resolveMeasuredAtIso (Bug 15)', () => {
  it('nowish → returns real now() with full millisecond precision (no truncation)', () => {
    const now = new Date('2026-06-16T15:11:40.123')
    const iso = resolveMeasuredAtIso('2026-06-16', '15:11', now)
    expect(iso).toBe(now.toISOString())
    // Seconds + millis survive (tz offsets are whole minutes, so :40.123 holds).
    expect(iso).toMatch(/:40\.123Z$/)
  })

  it('two nowish calls a moment apart yield DIFFERENT timestamps (no collision)', () => {
    const a = resolveMeasuredAtIso('2026-06-16', '15:11', new Date('2026-06-16T15:11:23'))
    const b = resolveMeasuredAtIso('2026-06-16', '15:11', new Date('2026-06-16T15:11:47.500'))
    expect(a).not.toBe(b)
  })

  it('backdated (not nowish) → honors the minute-precision time the patient chose', () => {
    const now = new Date('2026-06-16T15:11:40.123')
    const iso = resolveMeasuredAtIso('2026-06-16', '10:00', now)
    expect(iso).toBe(new Date('2026-06-16T10:00').toISOString())
    expect(iso).not.toBe(now.toISOString())
  })
})
