import {
  resolveEditedMeasuredAt,
  findMeasuredAtCollision,
  isEditableBadgeVisible,
} from './readingEdit'

// Bug 25 — the edit modal's <input type="time" step="1"> now exposes seconds, so
// two readings can share a minute (e.g. 16:15:30 vs 16:15:00) without an
// unavoidable :00 collision. resolveEditedMeasuredAt preserves the original
// milliseconds only when the chosen wall-clock SECOND is unchanged. Dates are
// built WITHOUT a trailing `Z` so the local parse and the local original line up
// regardless of CI timezone.

describe('resolveEditedMeasuredAt', () => {
  const original = '2026-06-16T01:35:24.500' // local, carries seconds + ms

  it('keeps the original ms when the second is unchanged', () => {
    const result = resolveEditedMeasuredAt(original, '2026-06-16', '01:35:24')
    expect(new Date(result).getTime()).toBe(new Date(original).getTime())
  })

  it('uses the chosen second (ms reset) when the seconds change', () => {
    const result = resolveEditedMeasuredAt(original, '2026-06-16', '01:35:30')
    const d = new Date(result)
    expect(d.getSeconds()).toBe(30)
    expect(d.getMilliseconds()).toBe(0)
    expect(d.getTime()).not.toBe(new Date(original).getTime())
  })

  it('honors a same-minute different-second edit (the collision-avoidance case)', () => {
    // move a reading to 01:35:45 so it no longer collides with one at 01:35:00
    const result = resolveEditedMeasuredAt(original, '2026-06-16', '01:35:45')
    const d = new Date(result)
    expect(d.getMinutes()).toBe(35)
    expect(d.getSeconds()).toBe(45)
  })

  it('resets to :00 when the picker supplies HH:MM only (minute change)', () => {
    const result = resolveEditedMeasuredAt(original, '2026-06-16', '01:36')
    expect(result.endsWith(':00.000Z')).toBe(true)
  })

  it('falls back to original when date/time are blank', () => {
    expect(resolveEditedMeasuredAt(original, '', '')).toBe(
      new Date(original).toISOString(),
    )
  })

  it('handles an unparseable original by using the chosen time', () => {
    const result = resolveEditedMeasuredAt('not-a-date', '2026-06-16', '01:35:10')
    expect(new Date(result).getSeconds()).toBe(10)
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
    const hit = findMeasuredAtCollision(entries, '2026-06-16T02:00:00Z', 'a')
    expect(hit?.id).toBe('c')
  })

  it('a different second is NOT a collision (seconds now settable)', () => {
    // 01:35:30 sits between the two same-minute readings — no exact match
    expect(
      findMeasuredAtCollision(entries, '2026-06-16T01:35:30.000Z', 'a'),
    ).toBeNull()
  })

  it('excludes the entry being edited (its own time is not a collision)', () => {
    const hit = findMeasuredAtCollision(entries, '2026-06-16T01:35:24.500Z', 'a')
    expect(hit).toBeNull()
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
