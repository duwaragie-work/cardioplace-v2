// N2 helper unit specs (2026-07-13). Focus on timezone edge cases and the
// overnight-wrap for quiet hours — the corners that Lakshitha's SMS worker
// (L5) will hit at scale.
import { jest } from '@jest/globals'
import {
  daysSinceLastReadingLocal,
  effectiveReminderSlot,
  hasLoggedReadingToday,
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
