import { jest } from '@jest/globals'
import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service.js'

// Mock the web-push SDK BEFORE importing the service so its `webpush.*` calls
// hit our spies instead of a real push service. Default export (the service
// does `import webpush from 'web-push'`).
const setVapidDetails = jest.fn()
const sendNotification = jest.fn() as any
jest.unstable_mockModule('web-push', () => ({
  default: { setVapidDetails, sendNotification },
}))

const {
  WebPushService,
  PUSH_LOCK_SCREEN_TITLE,
  PUSH_LOCK_SCREEN_BODY_ROUTINE,
  PUSH_LOCK_SCREEN_BODY_URGENT,
} = await import('./web-push.service.js')

const VAPID = {
  VAPID_PUBLIC_KEY: 'test-public-key',
  VAPID_PRIVATE_KEY: 'test-private-key',
  VAPID_SUBJECT: 'mailto:test@cardioplace.ai',
  NODE_ENV: 'test',
}

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return {
    get: <T = string>(key: string): T | undefined => env[key] as T | undefined,
  } as unknown as ConfigService
}

/**
 * `notification` defaults to a routine, non-alert-linked row (a cron reminder) —
 * the common case. Pass `notification` to override with an alert-linked row.
 */
function makePrisma(over: Partial<any> = {}): any {
  return {
    pushSubscription: {
      findMany: over.findMany ?? (jest.fn() as any).mockResolvedValue([]),
      upsert: (jest.fn() as any).mockResolvedValue({}),
      deleteMany: (jest.fn() as any).mockResolvedValue({ count: 1 }),
    },
    notification: {
      findUnique:
        over.findUnique ??
        (jest.fn() as any).mockResolvedValue({
          alertId: null,
          dispatchTrigger: 'SYSTEM_CRON',
          alert: null,
        }),
    },
  }
}

/** An alert-linked notification row at the given tier. */
function alertNotification(tier: string, alertId = 'alert-1') {
  return (jest.fn() as any).mockResolvedValue({
    alertId,
    dispatchTrigger: 'ALERT_CREATED',
    alert: { tier },
  })
}

const SUB = {
  endpoint: 'https://push.example/abc',
  p256dh: 'key-p256dh',
  auth: 'key-auth',
}

beforeEach(() => {
  setVapidDetails.mockClear()
  sendNotification.mockReset()
  sendNotification.mockResolvedValue(undefined)
  WebPushService.clearCapturedPushes()
})

describe('WebPushService', () => {
  it('configures VAPID and exposes the public key when keys are set', () => {
    const svc = new WebPushService(
      makeConfig(VAPID),
      makePrisma() as PrismaService,
    )
    expect(setVapidDetails).toHaveBeenCalledWith(
      'mailto:test@cardioplace.ai',
      'test-public-key',
      'test-private-key',
    )
    expect(svc.getPublicKey()).toBe('test-public-key')
  })

  it('saveSubscription upserts by endpoint with the current user + keys', async () => {
    const prisma = makePrisma()
    const svc = new WebPushService(makeConfig(VAPID), prisma as PrismaService)
    await svc.saveSubscription(
      'user-1',
      { endpoint: SUB.endpoint, keys: { p256dh: SUB.p256dh, auth: SUB.auth } },
      'Mozilla/5.0',
    )
    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { endpoint: SUB.endpoint },
        create: expect.objectContaining({ userId: 'user-1', endpoint: SUB.endpoint }),
        update: expect.objectContaining({ userId: 'user-1', p256dh: SUB.p256dh }),
      }),
    )
  })

  it('sends a web-push to each registered subscription', async () => {
    const prisma = makePrisma({
      findMany: (jest.fn() as any).mockResolvedValue([SUB]),
    })
    const svc = new WebPushService(makeConfig(VAPID), prisma as PrismaService)
    await svc.send('user-1', 'notif-1')

    expect(sendNotification).toHaveBeenCalledTimes(1)
    const [subArg, payloadArg] = sendNotification.mock.calls[0]
    expect(subArg).toEqual({
      endpoint: SUB.endpoint,
      keys: { p256dh: SUB.p256dh, auth: SUB.auth },
    })
    // Generic copy + the id the app uses to fetch the real content in-app.
    expect(JSON.parse(payloadArg)).toEqual({
      title: PUSH_LOCK_SCREEN_TITLE,
      body: PUSH_LOCK_SCREEN_BODY_ROUTINE,
      notificationId: 'notif-1',
      urgent: false,
      path: '/notifications?tab=notifications',
    })
  })

  it('prunes a subscription that returns 410 Gone', async () => {
    const prisma = makePrisma({
      findMany: (jest.fn() as any).mockResolvedValue([SUB]),
    })
    sendNotification.mockRejectedValueOnce({ statusCode: 410 })
    const svc = new WebPushService(makeConfig(VAPID), prisma as PrismaService)

    await svc.send('user-1', 'notif-1')

    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: SUB.endpoint },
    })
  })

  it('does NOT prune (and never throws) on a transient 500 error', async () => {
    const prisma = makePrisma({
      findMany: (jest.fn() as any).mockResolvedValue([SUB]),
    })
    sendNotification.mockRejectedValueOnce({ statusCode: 500 })
    const svc = new WebPushService(makeConfig(VAPID), prisma as PrismaService)

    await expect(svc.send('user-1', 'notif-1')).resolves.toBeUndefined()
    expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled()
  })

  it('no-ops when the user has no subscriptions', async () => {
    const prisma = makePrisma({
      findMany: (jest.fn() as any).mockResolvedValue([]),
    })
    const svc = new WebPushService(makeConfig(VAPID), prisma as PrismaService)
    await svc.send('user-1', 'notif-1')
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('no-ops entirely when VAPID keys are not configured', async () => {
    const prisma = makePrisma({
      findMany: (jest.fn() as any).mockResolvedValue([SUB]),
    })
    const svc = new WebPushService(makeConfig({ NODE_ENV: 'test' }), prisma as PrismaService)
    await svc.send('user-1', 'notif-1')
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled()
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('onNotificationCreated (event handler) dispatches a push', async () => {
    const prisma = makePrisma({
      findMany: (jest.fn() as any).mockResolvedValue([SUB]),
    })
    const svc = new WebPushService(makeConfig(VAPID), prisma as PrismaService)
    await svc.onNotificationCreated({
      userId: 'user-1',
      title: 'Confirm your medications',
      body: 'Tap to review.',
      notificationId: 'notif-1',
    })
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  // ── HIPAA: lock-screen must never carry clinical context ──────────────────
  // A push renders on a locked phone with no auth, so anything in the payload
  // is readable by whoever holds the handset. These notifications are the real
  // ones the app creates today (alert-resolution, medication-hold, intake) —
  // every one of them must come out the other side as the generic notice.
  describe('lock-screen payload carries no PHI', () => {
    const CLINICAL_NOTIFICATIONS = [
      {
        title: 'Blood pressure alert reviewed',
        body: 'Blood pressure alert reviewed: MEDICATION_CHANGE',
      },
      {
        title: 'Angioedema alert reviewed',
        body: 'Angioedema alert reviewed: STOP_MEDICATION',
      },
      {
        title: 'Medication hold — 45-day CMO review',
        body: 'Lisinopril has been on hold for 45 days and needs review.',
      },
      { title: 'Medicine list review', body: 'Please re-check a profile detail' },
    ]

    // Any of these surfacing on a lock screen reveals the patient's condition,
    // their medication, or that they are under a medication hold.
    const FORBIDDEN = [
      'Blood pressure',
      'blood pressure',
      'Angioedema',
      'angioedema',
      'Lisinopril',
      'hold',
      'Medication',
      'medication',
      'Medicine',
      'alert',
      'reviewed',
      'MEDICATION_CHANGE',
      'STOP_MEDICATION',
      'profile',
    ]

    it.each(CLINICAL_NOTIFICATIONS)(
      'strips "$title" down to the generic notice',
      async ({ title, body }) => {
        const prisma = makePrisma({
          findMany: (jest.fn() as any).mockResolvedValue([SUB]),
        })
        const svc = new WebPushService(makeConfig(VAPID), prisma as PrismaService)

        // Drive the real dispatch path the Prisma extension uses, so this
        // covers the wiring and not just `send` in isolation.
        await svc.onNotificationCreated({
          userId: 'user-1',
          title,
          body,
          notificationId: 'notif-1',
        })

        expect(sendNotification).toHaveBeenCalledTimes(1)
        const payload: string = sendNotification.mock.calls[0][1]

        for (const term of FORBIDDEN) {
          expect(payload).not.toContain(term)
        }
        const parsed = JSON.parse(payload)
        expect(parsed.title).toBe(PUSH_LOCK_SCREEN_TITLE)
        expect([
          PUSH_LOCK_SCREEN_BODY_ROUTINE,
          PUSH_LOCK_SCREEN_BODY_URGENT,
        ]).toContain(parsed.body)
        expect(parsed.notificationId).toBe('notif-1')
      },
    )

    it('still carries the notificationId so the app can open the real detail', async () => {
      const prisma = makePrisma({
        findMany: (jest.fn() as any).mockResolvedValue([SUB]),
      })
      const svc = new WebPushService(makeConfig(VAPID), prisma as PrismaService)
      await svc.onNotificationCreated({
        userId: 'user-1',
        title: 'Angioedema alert reviewed',
        body: 'Angioedema alert reviewed: STOP_MEDICATION',
        notificationId: 'notif-42',
      })
      expect(JSON.parse(sendNotification.mock.calls[0][1]).notificationId).toBe(
        'notif-42',
      )
    })
  })

  // ── Urgency: vary on HOW FAST to act, never on WHAT is wrong ──────────────
  // Without this, a hypertensive emergency and a monthly medication re-ask look
  // identical on the lock screen, so a patient can swipe past a real emergency.
  describe('urgency tier', () => {
    async function pushFor(findUnique: any) {
      const prisma = makePrisma({
        findMany: (jest.fn() as any).mockResolvedValue([SUB]),
        findUnique,
      })
      const svc = new WebPushService(makeConfig(VAPID), prisma as PrismaService)
      await svc.send('user-1', 'notif-1')
      return JSON.parse(sendNotification.mock.calls[0][1])
    }

    it.each([
      'BP_LEVEL_2',
      'BP_LEVEL_2_SYMPTOM_OVERRIDE',
      'TIER_1_CONTRAINDICATION',
      'TIER_1_ANGIOEDEMA',
    ])('%s → urgent notice', async (tier) => {
      const payload = await pushFor(alertNotification(tier))
      expect(payload.body).toBe(PUSH_LOCK_SCREEN_BODY_URGENT)
      expect(payload.urgent).toBe(true)
    })

    it.each([
      'BP_LEVEL_1_HIGH',
      'BP_LEVEL_1_LOW',
      'TIER_2_DISCREPANCY',
      'TIER_3_INFO',
    ])('%s → routine notice', async (tier) => {
      const payload = await pushFor(alertNotification(tier))
      expect(payload.body).toBe(PUSH_LOCK_SCREEN_BODY_ROUTINE)
      expect(payload.urgent).toBe(false)
    })

    it.each(['EMERGENCY_FLAGGED', 'MEDICATION_CONTRAINDICATION'])(
      'trigger %s is urgent even with no backing alert',
      async (dispatchTrigger) => {
        const payload = await pushFor(
          (jest.fn() as any).mockResolvedValue({
            alertId: null,
            dispatchTrigger,
            alert: null,
          }),
        )
        expect(payload.body).toBe(PUSH_LOCK_SCREEN_BODY_URGENT)
        expect(payload.urgent).toBe(true)
      },
    )

    it('a cron reminder stays routine', async () => {
      const payload = await pushFor(
        (jest.fn() as any).mockResolvedValue({
          alertId: null,
          dispatchTrigger: 'SYSTEM_CRON',
          alert: null,
        }),
      )
      expect(payload.body).toBe(PUSH_LOCK_SCREEN_BODY_ROUTINE)
      expect(payload.urgent).toBe(false)
    })

    // A DB blip must not promote every push to "open the app now" — that would
    // train patients to ignore the urgent notice entirely.
    it('falls back to routine (never urgent) when the lookup fails', async () => {
      const payload = await pushFor(
        (jest.fn() as any).mockRejectedValue(new Error('db down')),
      )
      expect(payload.body).toBe(PUSH_LOCK_SCREEN_BODY_ROUTINE)
      expect(payload.urgent).toBe(false)
      expect(payload.path).toBe('/notifications?tab=notifications')
    })

    it('never leaks the tier name itself into the payload', async () => {
      const payload = await pushFor(alertNotification('TIER_1_ANGIOEDEMA'))
      const raw = JSON.stringify(payload)
      expect(raw).not.toContain('ANGIOEDEMA')
      expect(raw).not.toContain('TIER_1')
      expect(raw).not.toContain('BP_LEVEL')
    })
  })

  // ── Tap routing ───────────────────────────────────────────────────────────
  // ALERT_* notifications are hidden from the in-app bell (they render in the
  // Alerts stream), so routing an alert push to the bell tab would land the
  // patient on a list that does not contain it.
  describe('tap target', () => {
    async function pathFor(findUnique: any) {
      const prisma = makePrisma({
        findMany: (jest.fn() as any).mockResolvedValue([SUB]),
        findUnique,
      })
      const svc = new WebPushService(makeConfig(VAPID), prisma as PrismaService)
      await svc.send('user-1', 'notif-1')
      return JSON.parse(sendNotification.mock.calls[0][1]).path
    }

    it('alert-linked push deep-links to the alert detail', async () => {
      expect(await pathFor(alertNotification('BP_LEVEL_2', 'alert-99'))).toBe(
        '/alerts?id=alert-99',
      )
    })

    it('non-alert push lands on the bell', async () => {
      expect(
        await pathFor(
          (jest.fn() as any).mockResolvedValue({
            alertId: null,
            dispatchTrigger: 'SYSTEM_CRON',
            alert: null,
          }),
        ),
      ).toBe('/notifications?tab=notifications')
    })
  })
})
