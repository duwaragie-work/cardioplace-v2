import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OnEvent } from '@nestjs/event-emitter'
import webpush from 'web-push'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  PUSH_EVENTS,
  type PushNotificationCreatedEvent,
} from './push.events.js'

/** The browser PushSubscription shape the client hands us at subscribe time. */
export interface WebPushSubscriptionInput {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/**
 * Real out-of-app Web Push transport for PUSH-channel Notifications.
 *
 * Mirrors EmailService's safety contract: configured implicitly from env (VAPID
 * keys present → enabled; absent → no-op, never throws), and every send path is
 * fire-and-forget — failures are logged, never propagated. The dispatch entry
 * point (`onNotificationCreated`) is an @OnEvent handler, so even the event
 * wrapper swallows throws: a push failure can never break notification creation
 * or any alert/reminder flow.
 *
 * Stale endpoints (browser cleared the subscription, permission revoked) surface
 * as 404/410 from the push service and are pruned so we don't retry dead rows.
 */
@Injectable()
export class WebPushService implements OnModuleInit {
  private readonly logger = new Logger(WebPushService.name)
  private readonly publicKey: string | undefined
  private readonly configured: boolean

  // ── Test-only capture ────────────────────────────────────────────────────
  // Non-production sends are recorded here so a spec can assert what WOULD be
  // pushed without standing up a real push service (VAPID keys need not be set).
  private static readonly CAPTURE_MAX = 100
  private static captured: Array<{ endpoint: string; payload: string }> = []
  private readonly captureEnabled: boolean

  static getCapturedPushes(): Array<{ endpoint: string; payload: string }> {
    return [...WebPushService.captured]
  }
  static clearCapturedPushes(): void {
    WebPushService.captured = []
  }

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.publicKey = this.config.get<string>('VAPID_PUBLIC_KEY') || undefined
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY') || undefined
    const subject =
      this.config.get<string>('VAPID_SUBJECT') || 'mailto:support@cardioplace.ai'
    this.configured = Boolean(this.publicKey && privateKey)
    this.captureEnabled =
      this.config.get<string>('NODE_ENV') !== 'production' ||
      this.config.get<string>('PUSH_CAPTURE') === '1'

    if (this.configured) {
      webpush.setVapidDetails(subject, this.publicKey!, privateKey!)
    }
  }

  onModuleInit(): void {
    this.logger.log(
      this.configured
        ? 'Web Push transport: VAPID keys set, ready to send'
        : 'Web Push transport: VAPID keys not set — push disabled (rows still saved to the bell)',
    )
  }

  /** Public VAPID key the frontend needs to create a PushSubscription. */
  getPublicKey(): string | undefined {
    return this.publicKey
  }

  /** Upsert a browser subscription for a user. Idempotent on `endpoint`. */
  async saveSubscription(
    userId: string,
    sub: WebPushSubscriptionInput,
    userAgent?: string,
  ): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: {
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent: userAgent ?? null,
      },
      // Re-subscribe on the same endpoint can rotate keys or move to another
      // user (shared browser) — keep the row current.
      update: {
        userId,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent: userAgent ?? null,
      },
    })
  }

  /** Remove a subscription (logout / unsubscribe). No-op if already gone. */
  async deleteSubscription(endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } })
  }

  /**
   * Event entry point — the push-dispatch Prisma extension emits this after a
   * PUSH Notification row is created. `async: true` runs it off the write path
   * and swallows any throw. Belt-and-suspenders: `send` itself never throws.
   */
  @OnEvent(PUSH_EVENTS.NOTIFICATION_CREATED, { async: true })
  async onNotificationCreated(
    event: PushNotificationCreatedEvent,
  ): Promise<void> {
    await this.send(event.userId, {
      title: event.title,
      body: event.body,
      notificationId: event.notificationId,
    })
  }

  /**
   * Push to every registered browser for a user. Never throws: a failure to one
   * endpoint is logged (and pruned if the endpoint is dead) without affecting
   * the others or the caller. Silent no-op when VAPID isn't configured.
   */
  async send(
    userId: string,
    message: { title: string; body: string; notificationId?: string },
  ): Promise<void> {
    if (!this.configured) return

    let subscriptions: Array<{
      endpoint: string
      p256dh: string
      auth: string
    }>
    try {
      subscriptions = await this.prisma.pushSubscription.findMany({
        where: { userId },
        select: { endpoint: true, p256dh: true, auth: true },
      })
    } catch (err) {
      this.logger.error(
        `Push: failed to load subscriptions for ${userId}`,
        err instanceof Error ? err.message : err,
      )
      return
    }

    if (subscriptions.length === 0) return

    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      notificationId: message.notificationId,
    })

    await Promise.all(
      subscriptions.map((s) => this.sendOne(s, payload)),
    )
  }

  private async sendOne(
    sub: { endpoint: string; p256dh: string; auth: string },
    payload: string,
  ): Promise<void> {
    if (this.captureEnabled) {
      WebPushService.captured.push({ endpoint: sub.endpoint, payload })
      if (WebPushService.captured.length > WebPushService.CAPTURE_MAX) {
        WebPushService.captured.splice(
          0,
          WebPushService.captured.length - WebPushService.CAPTURE_MAX,
        )
      }
    }
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
      )
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode
      // 404 Not Found / 410 Gone → the subscription is dead; prune it so we
      // don't keep retrying a browser that unsubscribed or cleared storage.
      if (statusCode === 404 || statusCode === 410) {
        this.logger.log(`Push: pruning expired endpoint (${statusCode})`)
        await this.deleteSubscription(sub.endpoint).catch(() => undefined)
        return
      }
      this.logger.error(
        `Push send failed (status ${statusCode ?? '?'})`,
        err instanceof Error ? err.message : err,
      )
    }
  }
}
