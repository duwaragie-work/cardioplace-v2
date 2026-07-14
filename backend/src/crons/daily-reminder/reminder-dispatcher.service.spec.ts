// Dispatcher spec (2026-07-13) — the channel fan-out is the single most
// important contract Nivakaran owes Lakshitha (spec §"Channel dispatcher").
// This spec pins:
//   • per-channel Notification-row shape (channel, dispatchTrigger, patientUserId)
//   • EMAIL send path invokes EmailService with the 4-arg disclosure shape
//   • SMS is a no-op today (L5 stub) — MUST NOT create a Notification row
//   • per-channel error isolation (one dead channel doesn't starve the others)
//   • missing email → EMAIL branch silently skips, other channels still fire
//   • patientUserId propagates for care-team alerts
//   • idempotent behavior on empty channel array
import { jest } from '@jest/globals'
import type { EmailService } from '../../email/email.service.js'
import {
  ReminderDispatcherService,
  type ReminderChannel,
} from './reminder-dispatcher.service.js'

function fakePrisma(createBehaviour: 'ok' | 'throw' = 'ok') {
  const created: any[] = []
  return {
    _created: created,
    notification: {
      create: jest.fn<any>().mockImplementation(async (args: any) => {
        if (createBehaviour === 'throw') throw new Error('notification.create failed')
        created.push(args.data)
        return { id: `n-${created.length}`, ...args.data }
      }),
    },
  } as any
}

function fakeEmailService(sendBehaviour: 'ok' | 'throw' = 'ok') {
  return {
    sendEmail: jest.fn<any>().mockImplementation(async () => {
      if (sendBehaviour === 'throw') throw new Error('SMTP failed')
    }),
  } as unknown as EmailService & { sendEmail: jest.Mock }
}

const RECIPIENT = {
  userId: 'p1',
  email: 'p1@test.local',
  name: 'Aisha',
}

const PAYLOAD = {
  title: 'Cardioplace daily check-in',
  body: 'Good morning, Aisha. When you\'re ready, take a moment to check your blood pressure.',
  emailTemplate: 'daily_reminder' as const,
  metadata: { dayCount: 1, tz: 'America/New_York' },
}

describe('ReminderDispatcherService', () => {
  it('DASHBOARD → one Notification row with channel=DASHBOARD', async () => {
    const prisma = fakePrisma()
    const email = fakeEmailService()
    const svc = new ReminderDispatcherService(prisma, email)
    await svc.dispatch(RECIPIENT, PAYLOAD, ['DASHBOARD'])
    expect(prisma._created).toHaveLength(1)
    expect(prisma._created[0].channel).toBe('DASHBOARD')
    expect(prisma._created[0].dispatchTrigger).toBe('SYSTEM_CRON')
    expect(prisma._created[0].userId).toBe('p1')
    expect(email.sendEmail).not.toHaveBeenCalled()
  })

  it('PUSH → one Notification row with channel=PUSH (auto-push extension fires downstream)', async () => {
    const prisma = fakePrisma()
    const email = fakeEmailService()
    const svc = new ReminderDispatcherService(prisma, email)
    await svc.dispatch(RECIPIENT, PAYLOAD, ['PUSH'])
    expect(prisma._created).toHaveLength(1)
    expect(prisma._created[0].channel).toBe('PUSH')
    expect(email.sendEmail).not.toHaveBeenCalled()
  })

  it('EMAIL → Notification row PLUS EmailService.sendEmail invoked', async () => {
    const prisma = fakePrisma()
    const email = fakeEmailService()
    const svc = new ReminderDispatcherService(prisma, email)
    await svc.dispatch(RECIPIENT, PAYLOAD, ['EMAIL'])
    expect(prisma._created).toHaveLength(1)
    expect(prisma._created[0].channel).toBe('EMAIL')
    expect(email.sendEmail).toHaveBeenCalledTimes(1)
    const [to, subject, html, disclosure] = email.sendEmail.mock.calls[0] as any[]
    expect(to).toBe('p1@test.local')
    expect(subject).toMatch(/Cardioplace/)
    expect(html).toContain('Aisha') // renderPlainEmail interpolates name
    expect(disclosure.template).toBe('daily_reminder')
    expect(disclosure.templateVersion).toBeTruthy()
    expect(disclosure.patientUserId).toBe('p1') // default = recipient.userId
    expect(disclosure.metadata).toEqual({ dayCount: 1, tz: 'America/New_York' })
  })

  it('EMAIL: missing recipient.email SILENTLY SKIPS (no Notification row, no send)', async () => {
    // Invited-but-not-activated rows can have no email — never crash the fan-out.
    const prisma = fakePrisma()
    const email = fakeEmailService()
    const svc = new ReminderDispatcherService(prisma, email)
    await svc.dispatch(
      { userId: 'p1', email: null, name: 'Aisha' },
      PAYLOAD,
      ['EMAIL'],
    )
    expect(prisma._created).toHaveLength(0)
    expect(email.sendEmail).not.toHaveBeenCalled()
  })

  it('SMS → NO-OP: no Notification row, no email call, no throw (spec §N2 — L5 wire-up pending)', async () => {
    const prisma = fakePrisma()
    const email = fakeEmailService()
    const svc = new ReminderDispatcherService(prisma, email)
    await svc.dispatch(RECIPIENT, PAYLOAD, ['SMS'])
    expect(prisma._created).toHaveLength(0)
    expect(email.sendEmail).not.toHaveBeenCalled()
  })

  it('multi-channel fan-out DASHBOARD+PUSH+EMAIL → three rows + one email', async () => {
    const prisma = fakePrisma()
    const email = fakeEmailService()
    const svc = new ReminderDispatcherService(prisma, email)
    await svc.dispatch(RECIPIENT, PAYLOAD, ['DASHBOARD', 'PUSH', 'EMAIL'])
    expect(prisma._created).toHaveLength(3)
    const channels = prisma._created.map((r: any) => r.channel).sort()
    expect(channels).toEqual(['DASHBOARD', 'EMAIL', 'PUSH'])
    expect(email.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('empty channel array → no side effects (no crashes on zero channels)', async () => {
    const prisma = fakePrisma()
    const email = fakeEmailService()
    const svc = new ReminderDispatcherService(prisma, email)
    await svc.dispatch(RECIPIENT, PAYLOAD, [])
    expect(prisma._created).toHaveLength(0)
    expect(email.sendEmail).not.toHaveBeenCalled()
  })

  it('duplicate channels in the array → dispatches each (caller controls dedup)', async () => {
    // The dispatcher does NOT dedup its input — if a caller passes ['PUSH', 'PUSH']
    // we honor it. This is intentional; the cron gates idempotency upstream via
    // the Notification.title match. Documented behavior.
    const prisma = fakePrisma()
    const email = fakeEmailService()
    const svc = new ReminderDispatcherService(prisma, email)
    await svc.dispatch(RECIPIENT, PAYLOAD, ['PUSH', 'PUSH'])
    expect(prisma._created).toHaveLength(2)
  })

  it('DASHBOARD failure does NOT prevent PUSH from dispatching (error isolation)', async () => {
    // First DASHBOARD create throws; subsequent PUSH create should still succeed.
    const created: any[] = []
    let firstCall = true
    const prisma = {
      notification: {
        create: jest.fn<any>().mockImplementation(async (args: any) => {
          if (firstCall) {
            firstCall = false
            throw new Error('DB timeout on DASHBOARD write')
          }
          created.push(args.data)
          return { id: `n-${created.length}`, ...args.data }
        }),
      },
    } as any
    const email = fakeEmailService()
    const svc = new ReminderDispatcherService(prisma, email)
    await svc.dispatch(RECIPIENT, PAYLOAD, ['DASHBOARD', 'PUSH'])
    // First call threw, second (PUSH) succeeded → one row landed.
    expect(created).toHaveLength(1)
    expect(created[0].channel).toBe('PUSH')
  })

  it('EMAIL sendEmail failure does NOT propagate (dispatcher swallows and continues)', async () => {
    const prisma = fakePrisma()
    const email = fakeEmailService('throw')
    const svc = new ReminderDispatcherService(prisma, email)
    // Even though SMTP fails, dispatch resolves and DASHBOARD row still lands.
    await expect(
      svc.dispatch(RECIPIENT, PAYLOAD, ['DASHBOARD', 'EMAIL']),
    ).resolves.toBeUndefined()
    // Notification row for EMAIL was created BEFORE the send throw, so we still
    // have 2 rows. If Prisma create is called first (order is DASHBOARD, EMAIL),
    // both DASHBOARD and EMAIL create succeed; only sendEmail throws.
    const channels = prisma._created.map((r: any) => r.channel).sort()
    expect(channels).toEqual(['DASHBOARD', 'EMAIL'])
  })

  it('care-team payload: patientUserId propagates to Notification row', async () => {
    // Care-team alert: recipient is provider, notification is ABOUT the patient.
    const prisma = fakePrisma()
    const email = fakeEmailService()
    const svc = new ReminderDispatcherService(prisma, email)
    await svc.dispatch(
      { userId: 'prov1', email: 'prov1@clinic.test', name: 'Dr. Smith', patientUserId: 'p1' },
      { ...PAYLOAD, emailTemplate: 'care_team_gap_alert' as const },
      ['DASHBOARD', 'EMAIL'],
    )
    for (const row of prisma._created) {
      expect(row.userId).toBe('prov1') // recipient
      expect(row.patientUserId).toBe('p1') // subject patient
    }
  })

  it('EMAIL disclosure metadata uses recipient.patientUserId when set (care-team fanout)', async () => {
    const prisma = fakePrisma()
    const email = fakeEmailService()
    const svc = new ReminderDispatcherService(prisma, email)
    await svc.dispatch(
      { userId: 'prov1', email: 'prov1@clinic.test', name: 'Dr. Smith', patientUserId: 'p1' },
      { ...PAYLOAD, emailTemplate: 'care_team_gap_alert' as const },
      ['EMAIL'],
    )
    const [, , , disclosure] = email.sendEmail.mock.calls[0] as any[]
    // §164.528 disclosure trail: the PATIENT the disclosure is ABOUT, not the
    // recipient. Care-team dispatch passes provider as recipient but patient as
    // the disclosure subject.
    expect(disclosure.patientUserId).toBe('p1')
  })

  it('EMAIL html body escapes HTML injection in the patient name (defensive)', async () => {
    const prisma = fakePrisma()
    const email = fakeEmailService()
    const svc = new ReminderDispatcherService(prisma, email)
    await svc.dispatch(
      { userId: 'p1', email: 'p1@test.local', name: '<script>alert(1)</script>' },
      PAYLOAD,
      ['EMAIL'],
    )
    const [, , html] = email.sendEmail.mock.calls[0] as any[]
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('never throws — even if EVERY channel handler fails', async () => {
    // Both prisma.notification.create AND emailService.sendEmail throw. The
    // dispatch() promise MUST still resolve; no channel error escapes the
    // per-channel try/catch inside dispatch().
    const prisma = fakePrisma('throw')
    const email = fakeEmailService('throw')
    const svc = new ReminderDispatcherService(prisma, email)
    await expect(
      svc.dispatch(RECIPIENT, PAYLOAD, ['DASHBOARD', 'PUSH', 'EMAIL', 'SMS']),
    ).resolves.toBeUndefined()
  })

  it('honors channel ORDER (dispatches DASHBOARD before PUSH when array is [D,P])', async () => {
    const prisma = fakePrisma()
    const email = fakeEmailService()
    const svc = new ReminderDispatcherService(prisma, email)
    await svc.dispatch(RECIPIENT, PAYLOAD, ['DASHBOARD', 'PUSH'])
    expect(prisma._created[0].channel).toBe('DASHBOARD')
    expect(prisma._created[1].channel).toBe('PUSH')
  })

  it('EMAIL: default disclosure.patientUserId falls back to recipient.userId when patientUserId is absent', async () => {
    // Reminder path (patient-facing, not care-team): recipient.patientUserId is
    // undefined, so §164.528 attribution defaults to the recipient themselves.
    const prisma = fakePrisma()
    const email = fakeEmailService()
    const svc = new ReminderDispatcherService(prisma, email)
    await svc.dispatch(RECIPIENT, PAYLOAD, ['EMAIL'])
    const [, , , disclosure] = email.sendEmail.mock.calls[0] as any[]
    expect(disclosure.patientUserId).toBe('p1')
  })

  it('body + title propagate to every Notification row identically', async () => {
    const prisma = fakePrisma()
    const email = fakeEmailService()
    const svc = new ReminderDispatcherService(prisma, email)
    await svc.dispatch(RECIPIENT, PAYLOAD, ['DASHBOARD', 'PUSH', 'EMAIL'])
    for (const row of prisma._created) {
      expect(row.title).toBe(PAYLOAD.title)
      expect(row.body).toBe(PAYLOAD.body)
    }
  })

  it('SMS channel co-exists with DASHBOARD+PUSH+EMAIL (fan-out ignores unimplemented channel)', async () => {
    const prisma = fakePrisma()
    const email = fakeEmailService()
    const svc = new ReminderDispatcherService(prisma, email)
    const channels: ReminderChannel[] = ['DASHBOARD', 'PUSH', 'EMAIL', 'SMS']
    await svc.dispatch(RECIPIENT, PAYLOAD, channels)
    // Three rows (SMS is a no-op) — proves L5 can safely start including SMS
    // in Niva's channel list without hitting a duplicate-row conflict.
    expect(prisma._created).toHaveLength(3)
  })
})
