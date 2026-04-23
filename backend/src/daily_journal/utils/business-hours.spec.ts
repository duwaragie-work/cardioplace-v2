// Phase/7 — business-hours math tests. Pure Luxon, no DB.

import {
  isWithinBusinessHours,
  nextBusinessHoursStart,
  type BusinessHoursConfig,
} from './business-hours.js'

const NY_8_TO_6: BusinessHoursConfig = {
  businessHoursStart: '08:00',
  businessHoursEnd: '18:00',
  businessHoursTimezone: 'America/New_York',
}

const LONDON_9_TO_5: BusinessHoursConfig = {
  businessHoursStart: '09:00',
  businessHoursEnd: '17:00',
  businessHoursTimezone: 'Europe/London',
}

// Helper: build a Date representing the given NY wall-clock time. April is DST
// (EDT = UTC-4), so NY 10:00 = UTC 14:00.
function nyTime(iso: string): Date {
  // Caller passes a UTC ISO that encodes the intended NY time. Tests express
  // both wall-clock + UTC explicitly for clarity.
  return new Date(iso)
}

describe('isWithinBusinessHours', () => {
  it('Mon 10:00 NY (inside window) → true', () => {
    // Monday 2026-04-20 10:00 EDT = 14:00 UTC
    expect(isWithinBusinessHours(nyTime('2026-04-20T14:00:00Z'), NY_8_TO_6)).toBe(true)
  })

  it('Mon 07:59 NY (before open) → false', () => {
    expect(isWithinBusinessHours(nyTime('2026-04-20T11:59:00Z'), NY_8_TO_6)).toBe(false)
  })

  it('Mon 08:00 NY (at open, inclusive) → true', () => {
    expect(isWithinBusinessHours(nyTime('2026-04-20T12:00:00Z'), NY_8_TO_6)).toBe(true)
  })

  it('Mon 18:00 NY (at close, exclusive) → false', () => {
    expect(isWithinBusinessHours(nyTime('2026-04-20T22:00:00Z'), NY_8_TO_6)).toBe(false)
  })

  it('Mon 22:00 NY (after-hours) → false', () => {
    // Monday 22:00 EDT = Tuesday 02:00 UTC
    expect(isWithinBusinessHours(nyTime('2026-04-21T02:00:00Z'), NY_8_TO_6)).toBe(false)
  })

  it('Saturday 12:00 NY (weekend) → false', () => {
    // Saturday 2026-04-25 12:00 EDT = 16:00 UTC
    expect(isWithinBusinessHours(nyTime('2026-04-25T16:00:00Z'), NY_8_TO_6)).toBe(false)
  })

  it('Sunday 23:00 NY → false', () => {
    // Sunday 2026-04-26 23:00 EDT = Monday 2026-04-27 03:00 UTC
    expect(isWithinBusinessHours(nyTime('2026-04-27T03:00:00Z'), NY_8_TO_6)).toBe(false)
  })

  it('London 09:00 local → true (respects tz)', () => {
    // Monday 2026-04-20 09:00 BST (UTC+1) = 08:00 UTC
    expect(isWithinBusinessHours(nyTime('2026-04-20T08:00:00Z'), LONDON_9_TO_5)).toBe(true)
  })

  it('malformed config (start > end) → false', () => {
    const bad: BusinessHoursConfig = {
      businessHoursStart: '18:00',
      businessHoursEnd: '08:00',
      businessHoursTimezone: 'America/New_York',
    }
    expect(isWithinBusinessHours(nyTime('2026-04-20T14:00:00Z'), bad)).toBe(false)
  })

  it('invalid tz → false', () => {
    const bad: BusinessHoursConfig = {
      businessHoursStart: '08:00',
      businessHoursEnd: '18:00',
      businessHoursTimezone: 'Not/A/Zone',
    }
    expect(isWithinBusinessHours(nyTime('2026-04-20T14:00:00Z'), bad)).toBe(false)
  })
})

describe('nextBusinessHoursStart', () => {
  it('already open → returns now (rounded to minute)', () => {
    const now = nyTime('2026-04-20T14:00:00Z') // Mon 10:00 NY
    const next = nextBusinessHoursStart(now, NY_8_TO_6)
    expect(next.getTime()).toBe(now.getTime())
  })

  it('Mon 07:00 NY → Mon 08:00 NY (same day open)', () => {
    const now = nyTime('2026-04-20T11:00:00Z') // Mon 07:00 NY
    const next = nextBusinessHoursStart(now, NY_8_TO_6)
    expect(next.toISOString()).toBe('2026-04-20T12:00:00.000Z') // Mon 08:00 NY
  })

  it('Mon 22:00 NY → Tue 08:00 NY', () => {
    const now = nyTime('2026-04-21T02:00:00Z') // Mon 22:00 NY
    const next = nextBusinessHoursStart(now, NY_8_TO_6)
    expect(next.toISOString()).toBe('2026-04-21T12:00:00.000Z') // Tue 08:00 NY
  })

  it('Fri 22:00 NY → Mon 08:00 NY (skip weekend)', () => {
    const now = nyTime('2026-04-25T02:00:00Z') // Fri 22:00 NY
    const next = nextBusinessHoursStart(now, NY_8_TO_6)
    expect(next.toISOString()).toBe('2026-04-27T12:00:00.000Z') // Mon 08:00 NY
  })

  it('Sat 10:00 NY → Mon 08:00 NY', () => {
    const now = nyTime('2026-04-25T14:00:00Z') // Sat 10:00 NY
    const next = nextBusinessHoursStart(now, NY_8_TO_6)
    expect(next.toISOString()).toBe('2026-04-27T12:00:00.000Z') // Mon 08:00 NY
  })

  it('Sun 23:59 NY → Mon 08:00 NY', () => {
    const now = nyTime('2026-04-27T03:59:00Z') // Sun 23:59 NY
    const next = nextBusinessHoursStart(now, NY_8_TO_6)
    expect(next.toISOString()).toBe('2026-04-27T12:00:00.000Z') // Mon 08:00 NY
  })

  it('malformed config → returns now unchanged (fail-open)', () => {
    const bad: BusinessHoursConfig = {
      businessHoursStart: 'nope',
      businessHoursEnd: '18:00',
      businessHoursTimezone: 'America/New_York',
    }
    const now = nyTime('2026-04-20T14:00:00Z')
    expect(nextBusinessHoursStart(now, bad).getTime()).toBe(now.getTime())
  })
})
