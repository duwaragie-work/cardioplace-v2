// N2 helper unit specs (2026-07-13). Focus on timezone edge cases and the
// overnight-wrap for quiet hours — the corners that Lakshitha's SMS worker
// (L5) will hit at scale.
import { jest } from '@jest/globals'
import { isBpNormalRange } from '@cardioplace/shared'
import {
  daysSinceLastReadingLocal,
  effectiveReminderSlot,
  hasLoggedReadingToday,
  hasLoggedReadingTodayForUser,
  isHhmmWithinQuietHours,
  isWithinQuietHours,
  localCalendarDayKey,
  localHour,
  localHourMinute,
} from './helpers.js'

// Minimal fake matching what the helpers actually call.
function fakePrisma(entries: Array<{ measuredAt: Date }>) {
  return {
    journalEntry: {
      findFirst: jest.fn<any>().mockImplementation((args: any) => {
        const filtered = entries.filter((e) => !!e.measuredAt)
        if (filtered.length === 0) return null
        // The service always orders by measuredAt desc + takes 1.
        const sorted = [...filtered].sort(
          (a, b) => b.measuredAt.getTime() - a.measuredAt.getTime(),
        )
        return sorted[0]
      }),
    },
  } as any
}

describe('localCalendarDayKey', () => {
  it('formats America/New_York local day for a UTC afternoon Date', () => {
    // 2026-07-13 12:30 UTC ≈ 08:30 ET → local day 2026-07-13
    expect(localCalendarDayKey(new Date('2026-07-13T12:30:00Z'), 'America/New_York')).toBe(
      '2026-07-13',
    )
  })

  it('rolls to the previous local day for early-UTC / late-ET times', () => {
    // 2026-07-14 03:00 UTC ≈ 23:00 ET on 2026-07-13
    expect(localCalendarDayKey(new Date('2026-07-14T03:00:00Z'), 'America/New_York')).toBe(
      '2026-07-13',
    )
  })

  it('falls back to UTC-day when the timezone id is invalid', () => {
    expect(localCalendarDayKey(new Date('2026-07-13T12:00:00Z'), 'Not/A/Zone')).toBe(
      '2026-07-13',
    )
  })
})

describe('localHourMinute', () => {
  it('emits zero-padded 24h HH:mm', () => {
    // 2026-07-13 05:07 UTC ≈ 01:07 ET
    expect(localHourMinute(new Date('2026-07-13T05:07:00Z'), 'America/New_York')).toBe('01:07')
  })

  it('normalises 24:00 → 00:00 at local midnight', () => {
    // 2026-07-14 04:00 UTC = 00:00 ET
    expect(localHourMinute(new Date('2026-07-14T04:00:00Z'), 'America/New_York')).toBe('00:00')
  })
})

describe('hasLoggedReadingToday', () => {
  it('returns false when the patient has never logged', async () => {
    const prisma = fakePrisma([])
    const r = await hasLoggedReadingToday(
      prisma,
      'u1',
      'America/New_York',
      new Date('2026-07-13T12:00:00Z'),
    )
    expect(r).toBe(false)
  })

  it('returns true when the last reading was earlier today (patient-local)', async () => {
    const prisma = fakePrisma([{ measuredAt: new Date('2026-07-13T11:00:00Z') }])
    const r = await hasLoggedReadingToday(
      prisma,
      'u1',
      'America/New_York',
      new Date('2026-07-13T18:00:00Z'),
    )
    expect(r).toBe(true)
  })

  it('returns false when the last reading was yesterday (patient-local)', async () => {
    const prisma = fakePrisma([{ measuredAt: new Date('2026-07-12T20:00:00Z') }])
    const r = await hasLoggedReadingToday(
      prisma,
      'u1',
      'America/New_York',
      new Date('2026-07-13T18:00:00Z'),
    )
    expect(r).toBe(false)
  })
})

describe('daysSinceLastReadingLocal', () => {
  it('returns POSITIVE_INFINITY for never-logged patients', async () => {
    const prisma = fakePrisma([])
    const r = await daysSinceLastReadingLocal(
      prisma,
      'u1',
      'America/New_York',
      new Date('2026-07-13T12:00:00Z'),
    )
    expect(r).toBe(Number.POSITIVE_INFINITY)
  })

  it('returns 0 for a same-day reading', async () => {
    // 13:00 UTC = 09:00 ET — same ET calendar day as the 18:00Z `now`.
    const prisma = fakePrisma([{ measuredAt: new Date('2026-07-13T13:00:00Z') }])
    const r = await daysSinceLastReadingLocal(
      prisma,
      'u1',
      'America/New_York',
      new Date('2026-07-13T18:00:00Z'),
    )
    expect(r).toBe(0)
  })

  it('returns 1 for a reading from the previous local day', async () => {
    const prisma = fakePrisma([{ measuredAt: new Date('2026-07-12T20:00:00Z') }])
    const r = await daysSinceLastReadingLocal(
      prisma,
      'u1',
      'America/New_York',
      new Date('2026-07-13T18:00:00Z'),
    )
    expect(r).toBe(1)
  })

  it('returns 4 for a reading four local days back', async () => {
    const prisma = fakePrisma([{ measuredAt: new Date('2026-07-09T14:00:00Z') }])
    const r = await daysSinceLastReadingLocal(
      prisma,
      'u1',
      'America/New_York',
      new Date('2026-07-13T14:00:00Z'),
    )
    expect(r).toBe(4)
  })
})

describe('isWithinQuietHours', () => {
  const tz = 'America/New_York'

  it('returns false when both fields are null (no preference set)', () => {
    expect(
      isWithinQuietHours(
        { quietHoursStart: null, quietHoursEnd: null, timezone: tz },
        new Date('2026-07-13T04:00:00Z'),
      ),
    ).toBe(false)
  })

  it('overnight wrap 22:00→07:00 — 03:00 local counts as quiet', () => {
    // 2026-07-13 07:00 UTC = 03:00 ET
    expect(
      isWithinQuietHours(
        { quietHoursStart: '22:00', quietHoursEnd: '07:00', timezone: tz },
        new Date('2026-07-13T07:00:00Z'),
      ),
    ).toBe(true)
  })

  it('overnight wrap 22:00→07:00 — 23:30 local counts as quiet', () => {
    // 2026-07-13 03:30 UTC = 23:30 ET (previous day)
    expect(
      isWithinQuietHours(
        { quietHoursStart: '22:00', quietHoursEnd: '07:00', timezone: tz },
        new Date('2026-07-13T03:30:00Z'),
      ),
    ).toBe(true)
  })

  it('overnight wrap 22:00→07:00 — 07:00 local is the END edge (not quiet)', () => {
    // 2026-07-13 11:00 UTC = 07:00 ET
    expect(
      isWithinQuietHours(
        { quietHoursStart: '22:00', quietHoursEnd: '07:00', timezone: tz },
        new Date('2026-07-13T11:00:00Z'),
      ),
    ).toBe(false)
  })

  it('overnight wrap — 12:00 local is not quiet', () => {
    expect(
      isWithinQuietHours(
        { quietHoursStart: '22:00', quietHoursEnd: '07:00', timezone: tz },
        new Date('2026-07-13T16:00:00Z'),
      ),
    ).toBe(false)
  })

  it('non-wrap 12:00→14:00 — 13:00 local counts as quiet', () => {
    // 17:00 UTC = 13:00 ET
    expect(
      isWithinQuietHours(
        { quietHoursStart: '12:00', quietHoursEnd: '14:00', timezone: tz },
        new Date('2026-07-13T17:00:00Z'),
      ),
    ).toBe(true)
  })

  it('non-wrap 12:00→14:00 — 14:00 local is NOT quiet (edge is exclusive)', () => {
    expect(
      isWithinQuietHours(
        { quietHoursStart: '12:00', quietHoursEnd: '14:00', timezone: tz },
        new Date('2026-07-13T18:00:00Z'),
      ),
    ).toBe(false)
  })

  it('degenerate start == end treats as always-awake', () => {
    expect(
      isWithinQuietHours(
        { quietHoursStart: '10:00', quietHoursEnd: '10:00', timezone: tz },
        new Date('2026-07-13T14:00:00Z'),
      ),
    ).toBe(false)
  })
})

describe('isHhmmWithinQuietHours (pure)', () => {
  it('overnight wrap 22:00→07:00 catches 03:00', () => {
    expect(isHhmmWithinQuietHours('03:00', '22:00', '07:00')).toBe(true)
  })
  it('overnight wrap treats end as EXCLUSIVE (07:00 not quiet)', () => {
    expect(isHhmmWithinQuietHours('07:00', '22:00', '07:00')).toBe(false)
  })
  it('non-wrap 12:00→14:00 catches 13:30', () => {
    expect(isHhmmWithinQuietHours('13:30', '12:00', '14:00')).toBe(true)
  })
})

describe('effectiveReminderSlot — N6 shift rule', () => {
  it('returns raw reminderTime when it is outside quiet hours', () => {
    expect(
      effectiveReminderSlot({
        reminderTime: '09:00',
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      }),
    ).toBe('09:00')
  })

  it('shifts to quietHoursEnd when the reminderTime falls INSIDE quiet hours', () => {
    // reminderTime = 05:30, quietHours 22:00 → 07:00 → 05:30 is inside → shift to 07:00
    expect(
      effectiveReminderSlot({
        reminderTime: '05:30',
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      }),
    ).toBe('07:00')
  })

  it('shift target is normalised to a 30-min slot', () => {
    // Non-slot quietHoursEnd '07:15' rounds DOWN to '07:00'
    expect(
      effectiveReminderSlot({
        reminderTime: '05:00',
        quietHoursStart: '22:00',
        quietHoursEnd: '07:15',
      }),
    ).toBe('07:00')
    // '07:45' rounds to '07:30'
    expect(
      effectiveReminderSlot({
        reminderTime: '05:00',
        quietHoursStart: '22:00',
        quietHoursEnd: '07:45',
      }),
    ).toBe('07:30')
  })

  it('returns raw reminderTime when quiet-hours fields are missing', () => {
    expect(
      effectiveReminderSlot({
        reminderTime: '09:00',
        quietHoursStart: null,
        quietHoursEnd: null,
      }),
    ).toBe('09:00')
  })

  it('returns null when there is no reminderTime configured', () => {
    expect(
      effectiveReminderSlot({
        reminderTime: null,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      }),
    ).toBe(null)
  })
})

describe('localHour', () => {
  it('returns 09 for 13:00 UTC in America/New_York (summer)', () => {
    expect(localHour(new Date('2026-07-13T13:00:00Z'), 'America/New_York')).toBe(9)
  })
  it('returns 22 for a Tokyo evening', () => {
    // 13:00 UTC = 22:00 JST
    expect(localHour(new Date('2026-07-13T13:00:00Z'), 'Asia/Tokyo')).toBe(22)
  })
})

// Gap 2 fix (2026-07-13) — convenience wrapper for Lakshitha's L5. Resolves
// timezone from the User row so the caller only needs to know the userId.
describe('hasLoggedReadingTodayForUser', () => {
  function fakePrismaWithUser(
    user: { timezone: string | null } | null,
    entries: Array<{ measuredAt: Date }>,
  ) {
    return {
      user: {
        findUnique: jest.fn<any>().mockResolvedValue(user),
      },
      journalEntry: {
        findFirst: jest.fn<any>().mockImplementation(() => {
          if (entries.length === 0) return null
          return entries.sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime())[0]
        }),
      },
    } as any
  }

  it('resolves timezone from the User row and delegates to hasLoggedReadingToday', async () => {
    const prisma = fakePrismaWithUser(
      { timezone: 'America/New_York' },
      [{ measuredAt: new Date('2026-07-13T13:00:00Z') }], // 09:00 ET today
    )
    const r = await hasLoggedReadingTodayForUser(
      prisma,
      'u1',
      new Date('2026-07-13T18:00:00Z'),
    )
    expect(r).toBe(true)
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { timezone: true },
    })
  })

  it('falls back to America/New_York when the user has no timezone', async () => {
    const prisma = fakePrismaWithUser(
      { timezone: null },
      [{ measuredAt: new Date('2026-07-13T13:00:00Z') }],
    )
    const r = await hasLoggedReadingTodayForUser(
      prisma,
      'u1',
      new Date('2026-07-13T18:00:00Z'),
    )
    expect(r).toBe(true) // ET fallback puts the reading in "today"
  })

  it('returns false when the user does not exist', async () => {
    const prisma = fakePrismaWithUser(null, [])
    const r = await hasLoggedReadingTodayForUser(prisma, 'missing')
    expect(r).toBe(false)
  })
})

// ─── Edge cases: DST, exotic timezones, malformed input ─────────────────────
// These are the corners that break naive Date/wall-clock math. The helpers
// here MUST stay deterministic across DST transitions (Ward 7 & 8 DC observes
// EST/EDT) and gracefully handle bad inputs from stale seed data or a
// misconfigured client.
describe('localCalendarDayKey — DST + exotic zones', () => {
  it('handles the spring-forward gap (US DST 2026-03-08 02:00 skips to 03:00)', () => {
    // 06:59 UTC = 01:59 EST just before spring-forward; 07:00 UTC = 03:00 EDT.
    expect(localCalendarDayKey(new Date('2026-03-08T06:59:00Z'), 'America/New_York')).toBe('2026-03-08')
    expect(localCalendarDayKey(new Date('2026-03-08T07:00:00Z'), 'America/New_York')).toBe('2026-03-08')
  })

  it('handles the fall-back overlap (US DST ends 2026-11-01 02:00 rewinds to 01:00)', () => {
    // 05:30 UTC on 11-01 = 01:30 EDT (first occurrence) — still 2026-11-01.
    // 06:30 UTC on 11-01 = 01:30 EST (second occurrence) — still 2026-11-01.
    expect(localCalendarDayKey(new Date('2026-11-01T05:30:00Z'), 'America/New_York')).toBe('2026-11-01')
    expect(localCalendarDayKey(new Date('2026-11-01T06:30:00Z'), 'America/New_York')).toBe('2026-11-01')
  })

  it('handles fractional-offset zones (India = UTC+5:30)', () => {
    // 18:30 UTC = 00:00 IST next day
    expect(localCalendarDayKey(new Date('2026-07-13T18:30:00Z'), 'Asia/Kolkata')).toBe('2026-07-14')
    // 18:29 UTC = 23:59 IST same day
    expect(localCalendarDayKey(new Date('2026-07-13T18:29:00Z'), 'Asia/Kolkata')).toBe('2026-07-13')
  })

  it('handles a Line Islands zone (UTC+14 — the furthest-forward local day)', () => {
    // 10:00 UTC on 13th = 00:00 next day in Kiritimati (UTC+14)
    expect(localCalendarDayKey(new Date('2026-07-13T10:00:00Z'), 'Pacific/Kiritimati')).toBe('2026-07-14')
  })
})

describe('localHourMinute — DST + malformed timezone', () => {
  it('spring-forward day: 06:30 UTC = 02:30 EST/EDT boundary', () => {
    // Before spring-forward (2026-03-08 06:30 UTC = 01:30 EST since it's before 07:00 UTC)
    expect(localHourMinute(new Date('2026-03-08T06:30:00Z'), 'America/New_York')).toBe('01:30')
  })

  it('returns "00:00" for an invalid timezone identifier (defensive fallback)', () => {
    expect(localHourMinute(new Date('2026-07-13T13:00:00Z'), 'Not/A/Real/Zone')).toBe('00:00')
  })
})

describe('isHhmmWithinQuietHours — boundary + malformed handling', () => {
  it('overnight wrap START is INCLUSIVE (22:00 counts as quiet)', () => {
    expect(isHhmmWithinQuietHours('22:00', '22:00', '07:00')).toBe(true)
  })
  it('overnight wrap END is EXCLUSIVE (07:00 counts as awake)', () => {
    expect(isHhmmWithinQuietHours('07:00', '22:00', '07:00')).toBe(false)
  })
  it('non-wrap START is INCLUSIVE (12:00 counts as quiet)', () => {
    expect(isHhmmWithinQuietHours('12:00', '12:00', '14:00')).toBe(true)
  })
  it('non-wrap END is EXCLUSIVE (14:00 counts as awake)', () => {
    expect(isHhmmWithinQuietHours('14:00', '12:00', '14:00')).toBe(false)
  })
})

describe('effectiveReminderSlot — malformed input', () => {
  it('leaves a non-30-min reminderTime (like "09:15") passed through if not inside quiet hours', () => {
    // The UI regex normally prevents non-30-min slots, but if a legacy row exists,
    // the helper does not mutate the value — the slot-match check downstream fails
    // (string equality) so nothing fires. Behaviour: return the raw value.
    expect(
      effectiveReminderSlot({
        reminderTime: '09:15',
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      }),
    ).toBe('09:15')
  })

  it('shift target for a non-30-min quietHoursEnd rounds to the nearest slot boundary', () => {
    // '07:35' is closer to :30 than :00. `normaliseToHalfHour` currently rounds
    // to :30 when minutes >= 30. Verify contract.
    expect(
      effectiveReminderSlot({
        reminderTime: '05:00',
        quietHoursStart: '22:00',
        quietHoursEnd: '07:35',
      }),
    ).toBe('07:30')
  })
})

describe('daysSinceLastReadingLocal — extreme + edge inputs', () => {
  it('returns a very large positive integer for readings months in the past (no overflow)', async () => {
    const prisma = fakePrisma([{ measuredAt: new Date('2025-01-01T12:00:00Z') }])
    const r = await daysSinceLastReadingLocal(
      prisma,
      'u1',
      'America/New_York',
      new Date('2026-07-13T18:00:00Z'),
    )
    // Roughly 559 days; assert lower bound with a wide margin so daylight
    // math variations don't flake this.
    expect(r).toBeGreaterThan(500)
    expect(r).toBeLessThan(700)
  })

  it('clamps to 0 (not negative) when last reading is somehow future-dated (bad seed data)', async () => {
    const prisma = fakePrisma([{ measuredAt: new Date('2099-01-01T12:00:00Z') }])
    const r = await daysSinceLastReadingLocal(
      prisma,
      'u1',
      'America/New_York',
      new Date('2026-07-13T18:00:00Z'),
    )
    // Helper uses Math.max(0, ...) so negatives clamp to 0.
    expect(r).toBe(0)
  })
})

// ─── isBpNormalRange boundary tests ─────────────────────────────────────────
// Cheap SBP/DBP predicate used by the N7 listener as the belt-and-braces
// second gate. Correctness at the band edges is what keeps borderline
// readings from getting "Looking good" appended.
describe('isBpNormalRange — boundaries', () => {
  it('SBP=90/DBP=60 (inclusive lower bound) → true', () => {
    expect(isBpNormalRange(90, 60)).toBe(true)
  })
  it('SBP=89 (just below) → false', () => {
    expect(isBpNormalRange(89, 70)).toBe(false)
  })
  it('SBP=129/DBP=84 (inclusive upper — just inside band) → true', () => {
    expect(isBpNormalRange(129, 84)).toBe(true)
  })
  it('SBP=130 (upper exclusive — Stage 1 HTN starts) → false', () => {
    expect(isBpNormalRange(130, 80)).toBe(false)
  })
  it('DBP=85 (upper exclusive) → false', () => {
    expect(isBpNormalRange(120, 85)).toBe(false)
  })
  it('DBP=59 (below hypotension band) → false', () => {
    expect(isBpNormalRange(110, 59)).toBe(false)
  })
  it('null SBP → false (missing data never gets positive language)', () => {
    expect(isBpNormalRange(null, 70)).toBe(false)
  })
  it('null DBP → false', () => {
    expect(isBpNormalRange(110, null)).toBe(false)
  })
  it('both null → false', () => {
    expect(isBpNormalRange(null, null)).toBe(false)
  })
  it('NaN input → false (defensive)', () => {
    expect(isBpNormalRange(Number.NaN, 70)).toBe(false)
    expect(isBpNormalRange(110, Number.NaN)).toBe(false)
  })
  it('classic AHA "normal" 118/76 → true', () => {
    expect(isBpNormalRange(118, 76)).toBe(true)
  })
  it('classic AHA "elevated" 122/78 → true (predicate deliberately widens ceiling to 130)', () => {
    // 120-129/<80 is "elevated" but not an alert — predicate treats it as
    // OK-enough to append "Looking good" per the module-level docstring.
    expect(isBpNormalRange(122, 78)).toBe(true)
  })
  it('Stage 2 HTN 165/105 → false', () => {
    expect(isBpNormalRange(165, 105)).toBe(false)
  })
})

// ─── hasLoggedReadingToday — deleted entries + multi-entry days ────────────
describe('hasLoggedReadingToday — deleted-entry filter', () => {
  it('IGNORES soft-deleted entries even if they are the most recent', async () => {
    // Fake prisma's findFirst mock filters on `deletedAt: null` in the where
    // clause. We simulate by only returning entries whose measuredAt exists
    // AND the caller's where clause matches. Because our fake doesn't
    // implement the where filter, we assert by injecting only a deleted row
    // (empty entries list — the query returns null).
    const prisma = fakePrisma([]) // no non-deleted rows
    const r = await hasLoggedReadingToday(
      prisma,
      'u1',
      'America/New_York',
      new Date('2026-07-13T18:00:00Z'),
    )
    expect(r).toBe(false)
    // Assert the where clause the helper builds includes deletedAt:null so a
    // deleted "last reading" wouldn't be picked up by real Prisma either.
    expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    )
  })
})
