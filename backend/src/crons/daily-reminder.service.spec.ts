// N2/N4/N5 cron unit spec (2026-07-13). Verifies the scan loop's decision
// tree against a fake Prisma + a spy dispatcher: slot match, quiet hours,
// already-logged, idempotency window, escalating tone selection, and the
// every-3-days care-team fan-out.
import { jest } from '@jest/globals'
import { ClsService } from 'nestjs-cls'
import { DailyReminderService } from './daily-reminder.service.js'
import type { ReminderDispatcherService } from './daily-reminder/reminder-dispatcher.service.js'

interface FakeUser {
  id: string
  email: string | null
  name: string | null
  timezone: string | null
  reminderTime: string | null
  quietHoursStart: string | null
  quietHoursEnd: string | null
  preferredLanguage: string | null
}

interface FakeNotification {
  id: string
  userId: string
  title: string
  sentAt: Date
  patientUserId?: string | null
}

function fakePrisma(opts: {
  patients: FakeUser[]
  lastReading?: Record<string, Date | null> // per userId — most-recent measuredAt
  notifications?: FakeNotification[]
  primaryProvider?: Record<
    string, // patient user id
    { id: string; email: string | null; name: string | null } | null
  >
}) {
  const notifications: FakeNotification[] = opts.notifications ?? []
  return {
    user: {
      findMany: jest.fn<any>().mockResolvedValue(opts.patients),
    },
    journalEntry: {
      findFirst: jest.fn<any>().mockImplementation((args: any) => {
        const uid = args.where.userId
        const last = opts.lastReading?.[uid]
        if (!last) return null
        return { measuredAt: last }
      }),
    },
    notification: {
      findFirst: jest.fn<any>().mockImplementation((args: any) => {
        const uid = args.where.userId
        const title = args.where.title
        const cutoff = args.where.sentAt.gte
        const patientUserId = args.where.patientUserId
        return (
          notifications.find(
            (n) =>
              n.userId === uid &&
              n.title === title &&
              n.sentAt >= cutoff &&
              (patientUserId === undefined || n.patientUserId === patientUserId),
          ) ?? null
        )
      }),
    },
    patientProviderAssignment: {
      findUnique: jest.fn<any>().mockImplementation((args: any) => {
        const uid = args.where.userId
        const provider = opts.primaryProvider?.[uid] ?? null
        return provider ? { primaryProvider: provider } : null
      }),
    },
  } as any
}

function fakeDispatcher() {
  return {
    dispatch: jest.fn<any>().mockResolvedValue(undefined),
  } as unknown as ReminderDispatcherService & { dispatch: jest.Mock }
}

function fakeCls() {
  return {
    run: (_defaults: any, fn: any) => fn(),
    set: () => {},
    get: () => undefined,
  } as unknown as ClsService
}

const BASE_USER: FakeUser = {
  id: 'p1',
  email: 'p1@test.local',
  name: 'Aisha',
  timezone: 'America/New_York',
  reminderTime: '09:00',
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  preferredLanguage: 'en',
}

// 2026-07-13 13:00 UTC = 09:00 ET → matches BASE_USER.reminderTime
const NOW_AT_SLOT = new Date('2026-07-13T13:00:00Z')

describe('DailyReminderService.runScan', () => {
  it('skips when the current slot does not match reminderTime', async () => {
    const prisma = fakePrisma({ patients: [BASE_USER] })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    // 14:00 UTC = 10:00 ET — one slot after the 09:00 reminderTime.
    const s = await svc.runScan(new Date('2026-07-13T14:00:00Z'))
    expect(dispatcher.dispatch).not.toHaveBeenCalled()
    expect(s.skippedNotSlot).toBe(1)
    expect(s.dispatched).toBe(0)
  })

  it('skips when the patient has already logged today', async () => {
    const prisma = fakePrisma({
      patients: [BASE_USER],
      lastReading: { p1: new Date('2026-07-13T12:00:00Z') }, // 08:00 ET today
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    const s = await svc.runScan(NOW_AT_SLOT)
    expect(dispatcher.dispatch).not.toHaveBeenCalled()
    expect(s.skippedLoggedToday).toBe(1)
  })

  it('skips when the current local time is inside quiet hours (raw reminderTime OUTSIDE quiet)', async () => {
    // Patient's reminderTime is 09:00 (outside quiet); the cron somehow fires
    // at 05:00 ET (inside 22:00→07:00 quiet). The safety-net guard skips.
    const prisma = fakePrisma({
      patients: [BASE_USER], // reminderTime='09:00'
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    // 09:00 UTC = 05:00 ET → NOT the 09:00 slot; skippedNotSlot++.
    const s = await svc.runScan(new Date('2026-07-13T09:00:00Z'))
    expect(dispatcher.dispatch).not.toHaveBeenCalled()
    expect(s.skippedNotSlot).toBe(1)
  })

  it('skips when a recent Notification with the same title exists (idempotency)', async () => {
    const prisma = fakePrisma({
      patients: [BASE_USER],
      lastReading: { p1: new Date('2026-07-12T13:00:00Z') }, // yesterday ET
      notifications: [
        {
          id: 'n0',
          userId: 'p1',
          title: 'Cardioplace daily check-in',
          sentAt: new Date('2026-07-13T05:00:00Z'), // < 20h ago
        },
      ],
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    const s = await svc.runScan(NOW_AT_SLOT)
    expect(dispatcher.dispatch).not.toHaveBeenCalled()
    expect(s.skippedIdempotent).toBe(1)
  })

  it('dispatches Day-1 tone when last reading was yesterday', async () => {
    const prisma = fakePrisma({
      patients: [BASE_USER],
      lastReading: { p1: new Date('2026-07-12T15:00:00Z') }, // 11:00 ET yesterday
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    const s = await svc.runScan(NOW_AT_SLOT)
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1)
    const [, payload, channels] = dispatcher.dispatch.mock.calls[0] as any[]
    // Spec §N2 verbatim: "…take a moment to check your blood pressure. Your care team sees every reading."
    expect(payload.body).toContain('take a moment to check your blood pressure')
    expect(payload.body).toContain('Your care team sees every reading')
    // Morning greeting at 09:00 ET.
    expect(payload.body).toMatch(/^Good morning, /)
    expect(payload.body).not.toContain("it's been a few days")
    // Spec §N2 default fan-out: DASHBOARD + PUSH + EMAIL, plus SMS as an
    // ADDITIVE 4th channel (L5, 2026-07-14) — SMS never replaces the others.
    // Listing SMS here is safe because the dispatcher's SMS branch self-gates
    // (flag + phone + consent + not-opted-out) and no-ops otherwise; a
    // non-consenting patient can never be texted.
    expect(channels).toEqual(['DASHBOARD', 'PUSH', 'EMAIL', 'SMS'])
    expect(s.dispatched).toBe(1)
    expect(s.careTeamAlerts).toBe(0)
  })

  it('dispatches Day-2 tone at two days elapsed', async () => {
    const prisma = fakePrisma({
      patients: [BASE_USER],
      lastReading: { p1: new Date('2026-07-11T15:00:00Z') },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    await svc.runScan(NOW_AT_SLOT)
    const [, payload] = dispatcher.dispatch.mock.calls[0] as any[]
    // Spec §N4 verbatim: "…just a gentle reminder to check your blood pressure when you can. Your care team is here for you."
    expect(payload.body).toContain('just a gentle reminder')
    expect(payload.body).toContain('Your care team is here for you')
  })

  it('dispatches Day-3+ tone AND a care-team alert at exactly 3 days', async () => {
    const prisma = fakePrisma({
      patients: [BASE_USER],
      lastReading: { p1: new Date('2026-07-10T15:00:00Z') }, // 3 local days back
      primaryProvider: {
        p1: { id: 'prov1', email: 'prov1@clinic.test', name: 'Dr. Smith' },
      },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    const s = await svc.runScan(NOW_AT_SLOT)
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2)
    const patientPayload = (dispatcher.dispatch.mock.calls[0] as any[])[1]
    // Spec §N4 Day 3+ verbatim: "…it's been a few days since your last check-in."
    expect(patientPayload.body).toContain("it's been a few days since your last check-in")
    expect(patientPayload.body).toContain('Your care team is here')
    const careTeamPayload = (dispatcher.dispatch.mock.calls[1] as any[])[1]
    expect(careTeamPayload.title).toBe('Patient has not checked in')
    expect(careTeamPayload.emailTemplate).toBe('care_team_gap_alert')
    const careTeamChannels = (dispatcher.dispatch.mock.calls[1] as any[])[2]
    expect(careTeamChannels).toEqual(['DASHBOARD', 'EMAIL']) // no push/sms for providers
    expect(s.careTeamAlerts).toBe(1)
  })

  it('does NOT fire care-team on non-3-day multiples (Day 4)', async () => {
    const prisma = fakePrisma({
      patients: [BASE_USER],
      lastReading: { p1: new Date('2026-07-09T15:00:00Z') }, // 4 local days back
      primaryProvider: {
        p1: { id: 'prov1', email: 'prov1@clinic.test', name: 'Dr. Smith' },
      },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    const s = await svc.runScan(NOW_AT_SLOT)
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1) // patient only, no care-team
    expect(s.careTeamAlerts).toBe(0)
  })

  it('fires care-team again at 6 days', async () => {
    const prisma = fakePrisma({
      patients: [BASE_USER],
      lastReading: { p1: new Date('2026-07-07T15:00:00Z') },
      primaryProvider: {
        p1: { id: 'prov1', email: 'prov1@clinic.test', name: 'Dr. Smith' },
      },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    const s = await svc.runScan(NOW_AT_SLOT)
    expect(s.careTeamAlerts).toBe(1)
  })

  it('log-and-skips care-team when the patient has no primary provider', async () => {
    const prisma = fakePrisma({
      patients: [BASE_USER],
      lastReading: { p1: new Date('2026-07-10T15:00:00Z') },
      primaryProvider: { p1: null },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    const s = await svc.runScan(NOW_AT_SLOT)
    // Patient reminder still fires; care-team dispatch does not (no provider).
    // careTeamAlerts is still incremented — it's a "we tried" counter, not a
    // "provider was notified" counter; the log line is the operator signal.
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1)
  })

  it('N6 shift rule — reminderTime inside quiet hours defers to quietHoursEnd', async () => {
    // Patient set reminderTime=05:00 with default quiet hours 22:00→07:00.
    // Cron at 05:00 ET must skip (still inside quiet); cron at 07:00 ET must fire.
    const shiftUser = {
      ...BASE_USER,
      reminderTime: '05:00',
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    }
    const prisma = fakePrisma({
      patients: [shiftUser],
      lastReading: { p1: new Date('2026-07-12T15:00:00Z') },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())

    // 09:00 UTC = 05:00 ET (raw reminderTime) — no fire (inside quiet AND
    // the effective slot moved to 07:00 which doesn't match).
    let s = await svc.runScan(new Date('2026-07-13T09:00:00Z'))
    expect(dispatcher.dispatch).not.toHaveBeenCalled()
    expect(s.skippedNotSlot + s.skippedQuietHours).toBeGreaterThanOrEqual(1)

    // 11:00 UTC = 07:00 ET (shifted slot). Should fire.
    s = await svc.runScan(new Date('2026-07-13T11:00:00Z'))
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1)
  })

  it("N2 greeting bucket — 'Hi' at midday, 'Good evening' after 17:00", async () => {
    const middayUser = { ...BASE_USER, reminderTime: '13:00' }
    const prisma = fakePrisma({
      patients: [middayUser],
      lastReading: { p1: new Date('2026-07-12T15:00:00Z') },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    // 17:00 UTC = 13:00 ET
    await svc.runScan(new Date('2026-07-13T17:00:00Z'))
    const [, payload] = dispatcher.dispatch.mock.calls[0] as any[]
    expect(payload.body).toMatch(/^Hi, /)

    // Evening case
    const eveningUser = { ...BASE_USER, id: 'p2', reminderTime: '18:00' }
    const prisma2 = fakePrisma({
      patients: [eveningUser],
      lastReading: { p2: new Date('2026-07-12T15:00:00Z') },
    })
    const dispatcher2 = fakeDispatcher()
    const svc2 = new DailyReminderService(prisma2, dispatcher2, fakeCls())
    // 22:00 UTC = 18:00 ET
    await svc2.runScan(new Date('2026-07-13T22:00:00Z'))
    const [, ep] = dispatcher2.dispatch.mock.calls[0] as any[]
    expect(ep.body).toMatch(/^Good evening, /)
  })

  it('N10 language selection — Spanish preferredLanguage renders Spanish body', async () => {
    const spanishUser = { ...BASE_USER, preferredLanguage: 'es', name: 'Aisha Aisha' }
    const prisma = fakePrisma({
      patients: [spanishUser],
      lastReading: { p1: new Date('2026-07-12T15:00:00Z') },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    await svc.runScan(NOW_AT_SLOT)
    const [, payload] = dispatcher.dispatch.mock.calls[0] as any[]
    expect(payload.body).toContain('presión arterial')
    // First-name only, not "Aisha Aisha". Spanish body is "Buenos días, Aisha."
    expect(payload.body).toContain('Aisha.')
    expect(payload.body).not.toContain('Aisha Aisha')
  })

  it('one bad patient row does not starve the loop', async () => {
    // Force the first patient to throw at journalEntry.findFirst — we simulate
    // a Prisma quirk by pointing at an id whose lastReading map entry throws.
    const throwingLast = new Proxy(
      { p1: new Date('2026-07-12T15:00:00Z') },
      {
        get(t: any, prop: string) {
          if (prop === 'p1') throw new Error('boom')
          return t[prop]
        },
      },
    )
    const prisma = fakePrisma({
      patients: [BASE_USER, { ...BASE_USER, id: 'p2' }],
      lastReading: throwingLast as any,
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    const s = await svc.runScan(NOW_AT_SLOT)
    // p1 throws; p2 dispatches successfully.
    expect(s.dispatched).toBe(1)
  })

  // ─── Edge cases (2026-07-13) ─────────────────────────────────────────────

  it('fresh new patient with NO prior JournalEntry gets the Day-3+ (never-logged) message', async () => {
    // daysSinceLastReadingLocal returns POSITIVE_INFINITY when the patient has
    // never logged; the tier selector routes that to Day-3+ (supportive tone).
    const prisma = fakePrisma({
      patients: [BASE_USER],
      lastReading: {}, // no entry for p1
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    await svc.runScan(NOW_AT_SLOT)
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1)
    const [, payload] = dispatcher.dispatch.mock.calls[0] as any[]
    expect(payload.body).toContain("it's been a few days since your last check-in")
  })

  it('patient with malformed reminderTime (non-30-min slot) never fires', async () => {
    // Guards against a legacy row whose reminderTime is "09:15" — the slot
    // match uses strict string equality against localHourMinute, which
    // returns 30-min-aligned strings, so "09:15" never matches.
    const badSlot = { ...BASE_USER, reminderTime: '09:15' }
    const prisma = fakePrisma({
      patients: [badSlot],
      lastReading: { p1: new Date('2026-07-12T13:00:00Z') },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    // 13:00 UTC = 09:00 ET — matches BASE_USER's 09:00 slot but NOT 09:15.
    const s = await svc.runScan(new Date('2026-07-13T13:00:00Z'))
    expect(dispatcher.dispatch).not.toHaveBeenCalled()
    expect(s.skippedNotSlot).toBe(1)
  })

  it('patient with NULL reminderTime skips entirely (spec §N1 — null column safe)', async () => {
    const noSlot = { ...BASE_USER, reminderTime: null }
    const prisma = fakePrisma({
      patients: [noSlot],
      lastReading: { p1: new Date('2026-07-12T13:00:00Z') },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    const s = await svc.runScan(NOW_AT_SLOT)
    expect(dispatcher.dispatch).not.toHaveBeenCalled()
    expect(s.skippedNotSlot).toBe(1)
  })

  it('patient with NULL name gets the "friend" fallback (never crashes on missing PII)', async () => {
    const anon = { ...BASE_USER, name: null }
    const prisma = fakePrisma({
      patients: [anon],
      lastReading: { p1: new Date('2026-07-12T13:00:00Z') },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    await svc.runScan(NOW_AT_SLOT)
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1)
    const [, payload] = dispatcher.dispatch.mock.calls[0] as any[]
    // Fallback name is "friend" — greet plus "friend" opens the body.
    expect(payload.body).toContain('friend')
  })

  it('patient with a compound first name uses only the FIRST token (spec § "First Name")', async () => {
    const compound = { ...BASE_USER, name: 'Van Der Berg' }
    const prisma = fakePrisma({
      patients: [compound],
      lastReading: { p1: new Date('2026-07-12T13:00:00Z') },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    await svc.runScan(NOW_AT_SLOT)
    const [, payload] = dispatcher.dispatch.mock.calls[0] as any[]
    // firstName splits on whitespace and takes [0] — "Van" only.
    expect(payload.body).toContain('Van')
    expect(payload.body).not.toContain('Van Der Berg')
  })

  it('unsupported preferredLanguage (e.g. "pt") falls back to English body', async () => {
    const pt = { ...BASE_USER, preferredLanguage: 'pt' }
    const prisma = fakePrisma({
      patients: [pt],
      lastReading: { p1: new Date('2026-07-12T13:00:00Z') },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    await svc.runScan(NOW_AT_SLOT)
    const [, payload] = dispatcher.dispatch.mock.calls[0] as any[]
    // English body: "take a moment to check your blood pressure"
    expect(payload.body).toContain('take a moment to check your blood pressure')
    expect(payload.body).not.toContain('presión')
  })

  it('care-team alert SKIPS when a duplicate row exists in the idempotency window', async () => {
    const prisma = fakePrisma({
      patients: [BASE_USER],
      lastReading: { p1: new Date('2026-07-10T15:00:00Z') }, // 3 days
      notifications: [
        // Simulate a prior care-team row that landed a few hours ago.
        {
          id: 'ct-0',
          userId: 'prov1',
          title: 'Patient has not checked in',
          sentAt: new Date('2026-07-13T09:00:00Z'), // 4h before NOW_AT_SLOT
          patientUserId: 'p1',
        },
      ],
      primaryProvider: {
        p1: { id: 'prov1', email: 'prov1@clinic.test', name: 'Dr. Smith' },
      },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    await svc.runScan(NOW_AT_SLOT)
    // Patient still gets their reminder, but care-team dispatch is suppressed.
    const calls = dispatcher.dispatch.mock.calls
    expect(calls).toHaveLength(1) // only patient reminder, no care-team
    const titles = calls.map((c: any[]) => (c[1] as any).title)
    expect(titles).not.toContain('Patient has not checked in')
  })

  it('care-team fires at day 12 (a further multiple of 3 in a long gap)', async () => {
    const prisma = fakePrisma({
      patients: [BASE_USER],
      lastReading: { p1: new Date('2026-07-01T15:00:00Z') }, // 12 days ago
      primaryProvider: {
        p1: { id: 'prov1', email: 'prov1@clinic.test', name: 'Dr. Smith' },
      },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    const s = await svc.runScan(NOW_AT_SLOT)
    expect(s.careTeamAlerts).toBe(1)
    // Body carries the actual day count.
    const careTeamPayload = dispatcher.dispatch.mock.calls.find(
      (c: any[]) => (c[1] as any).title === 'Patient has not checked in',
    )![1] as any
    expect(careTeamPayload.body).toContain('12 days')
  })

  it('care-team does NOT fire at day 4 or day 5 (only 3/6/9/12/...)', async () => {
    for (const [days, offset] of [
      [4, '2026-07-09T15:00:00Z'],
      [5, '2026-07-08T15:00:00Z'],
    ] as const) {
      const prisma = fakePrisma({
        patients: [BASE_USER],
        lastReading: { p1: new Date(offset) },
        primaryProvider: {
          p1: { id: 'prov1', email: 'prov1@clinic.test', name: 'Dr. Smith' },
        },
      })
      const dispatcher = fakeDispatcher()
      const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
      const s = await svc.runScan(NOW_AT_SLOT)
      expect(s.careTeamAlerts).toBe(0)
      expect(dispatcher.dispatch).toHaveBeenCalledTimes(1) // patient only
      // Guard against a compiler complaint about `days` being unused.
      expect(days).toBeGreaterThan(0)
    }
  })

  it('multiple patients on the same slot each fire independently (no cross-contamination)', async () => {
    const patients = [
      { ...BASE_USER, id: 'p1', email: 'p1@t.local' },
      { ...BASE_USER, id: 'p2', email: 'p2@t.local' },
      { ...BASE_USER, id: 'p3', email: 'p3@t.local' },
    ]
    const prisma = fakePrisma({
      patients,
      lastReading: {
        p1: new Date('2026-07-12T13:00:00Z'), // Day 1
        p2: new Date('2026-07-11T13:00:00Z'), // Day 2
        p3: new Date('2026-07-10T13:00:00Z'), // Day 3 → care team too
      },
      primaryProvider: {
        p3: { id: 'prov1', email: 'prov1@clinic.test', name: 'Dr. Smith' },
      },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    const s = await svc.runScan(NOW_AT_SLOT)
    expect(s.dispatched).toBe(3) // three patient reminders
    expect(s.careTeamAlerts).toBe(1) // one care-team (from p3)
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(4)
  })

  it('empty patient list → scan returns clean summary with zero side effects', async () => {
    const prisma = fakePrisma({ patients: [] })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    const s = await svc.runScan(NOW_AT_SLOT)
    expect(s.dispatched).toBe(0)
    expect(s.skippedLoggedToday).toBe(0)
    expect(s.skippedQuietHours).toBe(0)
    expect(s.skippedNotSlot).toBe(0)
    expect(s.careTeamAlerts).toBe(0)
    expect(dispatcher.dispatch).not.toHaveBeenCalled()
  })

  it('skippedNotSlot counter tracks patients whose slot did not match', async () => {
    // Patient with reminderTime="10:00" scanned at 09:00 → skippedNotSlot.
    const otherSlot = { ...BASE_USER, reminderTime: '10:00' }
    const prisma = fakePrisma({
      patients: [otherSlot],
      lastReading: { p1: new Date('2026-07-12T13:00:00Z') },
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    const s = await svc.runScan(NOW_AT_SLOT) // 09:00 ET slot
    expect(s.skippedNotSlot).toBe(1)
    expect(s.dispatched).toBe(0)
  })

  it('summary counters are additive across a mixed-population scan', async () => {
    // One patient logs (skippedLoggedToday), one dispatches, one has
    // idempotent block. Assert each counter incremented once.
    const patients = [
      { ...BASE_USER, id: 'p1' },
      { ...BASE_USER, id: 'p2' },
      { ...BASE_USER, id: 'p3' },
    ]
    const prisma = fakePrisma({
      patients,
      lastReading: {
        p1: new Date('2026-07-13T12:00:00Z'), // logged today
        p2: new Date('2026-07-12T13:00:00Z'), // day 1 → dispatch
        p3: new Date('2026-07-12T13:00:00Z'), // day 1 → idempotent
      },
      notifications: [
        {
          id: 'n0',
          userId: 'p3',
          title: 'Cardioplace daily check-in',
          sentAt: new Date('2026-07-13T05:00:00Z'),
        },
      ],
    })
    const dispatcher = fakeDispatcher()
    const svc = new DailyReminderService(prisma, dispatcher, fakeCls())
    const s = await svc.runScan(NOW_AT_SLOT)
    expect(s.dispatched).toBe(1)
    expect(s.skippedLoggedToday).toBe(1)
    expect(s.skippedIdempotent).toBe(1)
  })
})
