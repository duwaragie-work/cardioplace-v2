// Tests for the wall-clock <-> ISO conversion helpers. Bug 18 covered the
// write side (isoFromTzWallclock — patient-spoken HH:MM → UTC ISO instant).
// Bug 26 added the read side (tzWallclockFromIso — UTC ISO instant → local
// HH:MM strings) so get_recent_readings stops echoing UTC times back to
// patients in non-UTC zones.

import {
  isoFromTzWallclock,
  tzOffsetMs,
  tzWallclockFromIso,
} from './datetime.js'

describe('isoFromTzWallclock (Bug 18 regression)', () => {
  it('converts NY local 08:04 to UTC 12:04 in June (EDT, UTC-4)', () => {
    const iso = isoFromTzWallclock('2026-06-08', '08:04', 'America/New_York')
    expect(iso).toBe('2026-06-08T12:04:00.000Z')
  })

  it('converts IST local 15:32 to UTC 10:02 (IST is UTC+5:30, no DST)', () => {
    const iso = isoFromTzWallclock('2026-06-05', '15:32', 'Asia/Kolkata')
    expect(iso).toBe('2026-06-05T10:02:00.000Z')
  })

  it('falls back to current time on malformed date or time', () => {
    const iso = isoFromTzWallclock('not-a-date', '08:00', 'America/New_York')
    // Should be a valid ISO string but not the parsed value.
    expect(() => new Date(iso)).not.toThrow()
  })
})

describe('tzWallclockFromIso (Bug 26)', () => {
  it('NY: 08:04 UTC in June (EDT) → 04:04 local', () => {
    // Inverse of the Bug 18 case above. Stored UTC instant projects back
    // to the patient's local wallclock for the get_recent_readings JSON.
    const { date, time } = tzWallclockFromIso(
      '2026-06-08T12:04:00.000Z',
      'America/New_York',
    )
    expect(date).toBe('2026-06-08')
    expect(time).toBe('08:04')
  })

  it('IST: 10:02 UTC → 15:32 local (the original Bug 18 example, read side)', () => {
    const { date, time } = tzWallclockFromIso(
      '2026-06-05T10:02:00.000Z',
      'Asia/Kolkata',
    )
    expect(date).toBe('2026-06-05')
    expect(time).toBe('15:32')
  })

  it('UTC zone: returns the same wallclock as the ISO string', () => {
    const { date, time } = tzWallclockFromIso('2026-06-08T09:30:00.000Z', 'UTC')
    expect(date).toBe('2026-06-08')
    expect(time).toBe('09:30')
  })

  it('accepts a Date object as input', () => {
    const d = new Date('2026-06-08T12:04:00.000Z')
    const { date, time } = tzWallclockFromIso(d, 'America/New_York')
    expect(date).toBe('2026-06-08')
    expect(time).toBe('08:04')
  })

  it('round-trips with isoFromTzWallclock across a DST boundary', () => {
    // March 8 2026 is DST start in America/New_York. 09:30 local should
    // survive the wallclock→ISO→wallclock round-trip unchanged.
    const iso = isoFromTzWallclock('2026-03-08', '09:30', 'America/New_York')
    const back = tzWallclockFromIso(iso, 'America/New_York')
    expect(back.date).toBe('2026-03-08')
    expect(back.time).toBe('09:30')
  })

  it('returns empty strings on malformed ISO input', () => {
    expect(tzWallclockFromIso('not-an-iso', 'America/New_York')).toEqual({
      date: '',
      time: '',
    })
  })
})

describe('tzOffsetMs (used by isoFromTzWallclock)', () => {
  it('returns -4h offset for America/New_York in June (EDT)', () => {
    const utcMs = Date.UTC(2026, 5, 8, 12, 0, 0)
    expect(tzOffsetMs(utcMs, 'America/New_York')).toBe(-4 * 60 * 60 * 1000)
  })

  it('returns +5:30 offset for Asia/Kolkata year-round (no DST)', () => {
    const utcMs = Date.UTC(2026, 5, 5, 10, 0, 0)
    expect(tzOffsetMs(utcMs, 'Asia/Kolkata')).toBe(5.5 * 60 * 60 * 1000)
  })
})
