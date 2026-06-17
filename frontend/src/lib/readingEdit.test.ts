import {
  resolveEditedMeasuredAt,
  findMeasuredAtCollision,
  hasSubMinutePrecision,
  localTimeWithSeconds,
  isEditableBadgeVisible,
} from './readingEdit'

// Bug 25 — the edit modal's <input type="time"> is minute-only. Rebuilding
// measuredAt from date+time alone truncated seconds to :00, losing the Bug 15
// Part D sub-minute precision and manufacturing collisions. These helpers keep
// the picker honest. Dates are constructed WITHOUT a trailing `Z` so the local
// minute-key derivation and the local parse line up regardless of CI timezone.

describe('resolveEditedMeasuredAt', () => {
  const original = '2026-06-16T01:35:24.500' // local, carries seconds + ms

  it('preserves the original seconds/ms when the minute is unchanged', () => {
    const result = resolveEditedMeasuredAt(original, '2026-06-16', '01:35')
    // same exact instant — seconds + ms survived the round-trip
    expect(new Date(result).getTime()).toBe(new Date(original).getTime())
    expect(result.endsWith(':00.000Z')).toBe(false)
  })

  it('resets seconds to :00 when the minute actually changes', () => {
    const result = resolveEditedMeasuredAt(original, '2026-06-16', '01:36')
    expect(result.endsWith(':00.000Z')).toBe(true)
    expect(new Date(result).getTime()).not.toBe(new Date(original).getTime())
  })

  it('resets seconds to :00 when the date changes but the time matches', () => {
    const result = resolveEditedMeasuredAt(original, '2026-06-17', '01:35')
    expect(result.endsWith(':00.000Z')).toBe(true)
  })

  it('falls back to original when date/time are blank', () => {
    expect(resolveEditedMeasuredAt(original, '', '')).toBe(
      new Date(original).toISOString(),
    )
  })

  it('handles an unparseable original by using the chosen minute', () => {
    const result = resolveEditedMeasuredAt('not-a-date', '2026-06-16', '01:35')
    expect(result.endsWith(':00.000Z')).toBe(true)
  })
})

describe('findMeasuredAtCollision', () => {
  const entries = [
    { id: 'a', measuredAt: '2026-06-16T01:35:24.500Z' },
    { id: 'b', measuredAt: '2026-06-16T01:35:47.000Z' },
    { id: 'c', measuredAt: '2026-06-16T02:00:00.000Z' },
  ]

  it('finds a different entry at the exact same instant', () => {
    const hit = findMeasuredAtCollision(entries, '2026-06-16T01:35:47.000Z', 'a')
    expect(hit?.id).toBe('b')
  })

  it('matches by epoch ms regardless of ISO formatting', () => {
    // same instant, no millis in the query string
    const hit = findMeasuredAtCollision(entries, '2026-06-16T02:00:00Z', 'a')
    expect(hit?.id).toBe('c')
  })

  it('excludes the entry being edited (its own time is not a collision)', () => {
    const hit = findMeasuredAtCollision(entries, '2026-06-16T01:35:24.500Z', 'a')
    expect(hit).toBeNull()
  })

  it('returns null when no entry occupies the instant', () => {
    expect(
      findMeasuredAtCollision(entries, '2026-06-16T03:00:00.000Z', 'a'),
    ).toBeNull()
  })
})

describe('hasSubMinutePrecision', () => {
  it('true when seconds are non-zero', () => {
    expect(hasSubMinutePrecision('2026-06-16T01:35:24.000Z')).toBe(true)
  })
  it('true when only millis are non-zero', () => {
    expect(hasSubMinutePrecision('2026-06-16T01:35:00.250Z')).toBe(true)
  })
  it('false on an exact minute', () => {
    expect(hasSubMinutePrecision('2026-06-16T01:35:00.000Z')).toBe(false)
  })
  it('false for an unparseable ISO', () => {
    expect(hasSubMinutePrecision('nope')).toBe(false)
  })
})

describe('localTimeWithSeconds', () => {
  it('renders HH:MM:SS for the original-time hint', () => {
    // local-parsed (no Z) so the formatted seconds are deterministic
    expect(localTimeWithSeconds('2026-06-16T01:35:09')).toBe('01:35:09')
  })
  it('returns empty string for an unparseable ISO', () => {
    expect(localTimeWithSeconds('nope')).toBe('')
  })
})

describe('isEditableBadgeVisible', () => {
  const now = new Date('2026-06-16T01:35:00.000Z').getTime()

  it('true while the deferral is in the future', () => {
    expect(isEditableBadgeVisible('2026-06-16T01:40:00.000Z', now)).toBe(true)
  })
  it('false once the deferral has elapsed', () => {
    expect(isEditableBadgeVisible('2026-06-16T01:30:00.000Z', now)).toBe(false)
  })
  it('false when the backend nulled the deferral (fast-fire / admin / Option D)', () => {
    expect(isEditableBadgeVisible(null, now)).toBe(false)
    expect(isEditableBadgeVisible(undefined, now)).toBe(false)
  })
  it('false for an unparseable timestamp', () => {
    expect(isEditableBadgeVisible('nope', now)).toBe(false)
  })
})
