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

const { WebPushService } = await import('./web-push.service.js')

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

function makePrisma(over: Partial<any> = {}): any {
  return {
    pushSubscription: {
      findMany: over.findMany ?? (jest.fn() as any).mockResolvedValue([]),
      upsert: (jest.fn() as any).mockResolvedValue({}),
      deleteMany: (jest.fn() as any).mockResolvedValue({ count: 1 }),
    },
  }
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
    await svc.send('user-1', { title: 'Confirm your medications', body: 'Tap to review.' })

    expect(sendNotification).toHaveBeenCalledTimes(1)
    const [subArg, payloadArg] = sendNotification.mock.calls[0]
    expect(subArg).toEqual({
      endpoint: SUB.endpoint,
      keys: { p256dh: SUB.p256dh, auth: SUB.auth },
    })
    expect(JSON.parse(payloadArg)).toMatchObject({
      title: 'Confirm your medications',
      body: 'Tap to review.',
    })
  })

  it('prunes a subscription that returns 410 Gone', async () => {
    const prisma = makePrisma({
      findMany: (jest.fn() as any).mockResolvedValue([SUB]),
    })
    sendNotification.mockRejectedValueOnce({ statusCode: 410 })
    const svc = new WebPushService(makeConfig(VAPID), prisma as PrismaService)

    await svc.send('user-1', { title: 't', body: 'b' })

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

    await expect(svc.send('user-1', { title: 't', body: 'b' })).resolves.toBeUndefined()
    expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled()
  })

  it('no-ops when the user has no subscriptions', async () => {
    const prisma = makePrisma({
      findMany: (jest.fn() as any).mockResolvedValue([]),
    })
    const svc = new WebPushService(makeConfig(VAPID), prisma as PrismaService)
    await svc.send('user-1', { title: 't', body: 'b' })
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('no-ops entirely when VAPID keys are not configured', async () => {
    const prisma = makePrisma({
      findMany: (jest.fn() as any).mockResolvedValue([SUB]),
    })
    const svc = new WebPushService(makeConfig({ NODE_ENV: 'test' }), prisma as PrismaService)
    await svc.send('user-1', { title: 't', body: 'b' })
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
})
