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
 * The ONLY copy that ever reaches a device. A push renders on a locked phone
 * with no authentication, so anything in it is readable by whoever is holding
 * the handset — that makes clinical context (alert type, drug name, hold
 * status) PHI in the clear. Keep these strings clinically empty and
 * category-free; product may reword them, but they must never name what the
 * notification is about.
 *
 * We vary on URGENCY, never on CATEGORY. "Please open Cardioplace now" tells the
 * patient how fast to act without revealing what is wrong — whereas a category
 * ("Blood pressure alert", "Medication hold") would disclose the condition
 * itself, which is the part that identifies them. Urgency is the one axis that
 * carries clinical value with no clinical content.
 *
 * Without this split, a hypertensive emergency and a routine monthly medication
 * re-ask render identically, so a patient can dismiss a genuine emergency as
 * just another reminder.
 *
 * WORDING IS CLINICAL: Dr. Singal owns these two strings. Do not reword without
 * her sign-off (see CLAUDE.md, "Clinical authority").
 *
 * Deliberately backend-owned rather than baked into the service worker: a SW is
 * aggressively cached, so copy baked there can take days to reach every device.
 */
export const PUSH_LOCK_SCREEN_TITLE = 'Cardioplace'
export const PUSH_LOCK_SCREEN_BODY_ROUTINE = 'You have a new update'
export const PUSH_LOCK_SCREEN_BODY_URGENT = 'Please open Cardioplace now'

/**
 * Alert tiers that warrant the urgent notice: the non-dismissable, act-now
 * classes per CLINICAL_SPEC — BP Level 2 (hypertensive emergency, incl. the
 * symptom override) and the Tier 1 contraindication classes (incl. the
 * compressed-ladder angioedema variant). Everything else — BP Level 1, Tier 2
 * discrepancies, Tier 3 info, reminders, re-asks — is routine.
 */
const URGENT_ALERT_TIERS: ReadonlySet<string> = new Set([
  'BP_LEVEL_2',
  'BP_LEVEL_2_SYMPTOM_OVERRIDE',
  'TIER_1_CONTRAINDICATION',
  'TIER_1_ANGIOEDEMA',
])

/**
 * Urgent notifications with no backing DeviationAlert, so no tier to read:
 * the chat/voice emergency page and the intake contraindication flag.
 */
const URGENT_TRIGGERS: ReadonlySet<string> = new Set([
  'EMERGENCY_FLAGGED',
  'MEDICATION_CONTRAINDICATION',
])

/** Where a tapped push should land. Paths only — no clinical content. */
const BELL_PATH = '/notifications?tab=notifications'

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
    // `event.title` / `event.body` hold the real (clinical) copy — that is for
    // the in-app bell, which is behind auth. It is deliberately NOT passed on:
    // `send` takes only the id, so the clinical text cannot reach a device.
    await this.send(event.userId, event.notificationId)
  }

  /**
   * Push to every registered browser for a user. Never throws: a failure to one
   * endpoint is logged (and pruned if the endpoint is dead) without affecting
   * the others or the caller. Silent no-op when VAPID isn't configured.
   *
   * HIPAA — lock-screen safety: takes only a `notificationId`, never the
   * notification's title/body. Every push in the system funnels through here, so
   * scrubbing at this one choke point means no current or future notification
   * type can leak clinical context to a locked screen — no need to police the
   * copy at each of the dozens of call sites that create PUSH rows. The device
   * gets a generic notice plus the id; the app fetches the real content in-app,
   * behind auth, when the patient taps it.
   */
  async send(userId: string, notificationId?: string): Promise<void> {
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

    // Resolved AFTER the subscription check so we don't pay for the lookup when
    // the user has no device registered.
    const { urgent, path } = await this.resolveRouting(notificationId)

    const payload = JSON.stringify({
      title: PUSH_LOCK_SCREEN_TITLE,
      body: urgent ? PUSH_LOCK_SCREEN_BODY_URGENT : PUSH_LOCK_SCREEN_BODY_ROUTINE,
      notificationId,
      // Lets the service worker make an urgent push sticky (requireInteraction)
      // so it can't be silently swiped past. Says "act now", not what about.
      urgent,
      path,
    })

    await Promise.all(
      subscriptions.map((s) => this.sendOne(s, payload)),
    )
  }

  /**
   * Decide the two things the device is allowed to know: how urgent this is, and
   * where tapping should land. Reads ONLY the notification's `dispatchTrigger`
   * and its alert's `tier` — never the title/body — so no clinical text can be
   * reached from here even by accident.
   *
   * Routing matters because `ALERT_*` notifications are deliberately hidden from
   * the in-app bell (they render in the Alerts stream instead — see
   * NotificationTrigger in schema). Sending an alert push to the bell tab would
   * land the patient on a list that does not contain it, so alert-linked pushes
   * go straight to the alert detail page.
   *
   * Fails to ROUTINE, never urgent: a DB blip must not turn every push into
   * "open the app now", which would train patients to ignore the urgent notice.
   * A genuine emergency still escalates to the care team via the T+N ladder
   * regardless of what the patient's lock screen said.
   */
  private async resolveRouting(
    notificationId?: string,
  ): Promise<{ urgent: boolean; path: string }> {
    if (!notificationId) return { urgent: false, path: BELL_PATH }
    try {
      const notification = await this.prisma.notification.findUnique({
        where: { id: notificationId },
        select: {
          alertId: true,
          dispatchTrigger: true,
          alert: { select: { tier: true } },
        },
      })
      if (!notification) return { urgent: false, path: BELL_PATH }

      // `tier` is nullable (legacy v1 alert rows predate it). A null tier can't
      // be classified, so it stays routine — consistent with the fail-safe
      // below, and those rows never carry a v2 emergency anyway.
      const tier = notification.alert?.tier ?? null
      const urgent =
        URGENT_TRIGGERS.has(notification.dispatchTrigger) ||
        (tier !== null && URGENT_ALERT_TIERS.has(tier))

      // An alert id is an opaque uuid — it names nothing clinical.
      const path = notification.alertId
        ? `/alerts?id=${notification.alertId}`
        : BELL_PATH

      return { urgent, path }
    } catch (err) {
      this.logger.error(
        `Push: failed to resolve routing for ${notificationId}`,
        err instanceof Error ? err.message : err,
      )
      return { urgent: false, path: BELL_PATH }
    }
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
