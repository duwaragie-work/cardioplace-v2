import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { EncryptionService } from '../../common/encryption.service.js'
import { EMAIL_TEMPLATE_VERSION } from '../../email/email-templates.js'
import { EmailService } from '../../email/email.service.js'
import type { EmailTemplateName } from '../../email/email-templates.registry.js'
import { NotificationChannel } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import {
  SMS_REMINDER_TEMPLATE_ID,
  resolveSmsLanguage,
  smsReminderBody,
} from '../../sms/sms-copy.js'
import { SmsService } from '../../sms/sms.service.js'

/**
 * Channels the reminder dispatcher can fan out to. `SMS` is declared here so
 * Nivakaran's cron can pass it through today; the branch is a no-op until
 * Lakshitha's L4 (adds the `SMS` value to the Prisma NotificationChannel enum)
 * and L5 (Twilio transport in SmsService) land. See coordination table in
 * plans/…-diffie.md.
 */
export type ReminderChannel = 'DASHBOARD' | 'PUSH' | 'EMAIL' | 'SMS'

export interface ReminderRecipient {
  userId: string
  email: string | null
  name: string
  patientUserId?: string | null // for care-team alerts: the patient this concerns
}

export interface ReminderPayload {
  title: string
  body: string
  /** EmailTemplateName used when EMAIL is in the channel set. Kept as a
   *  required field so N6 disclosure rows always classify correctly. */
  emailTemplate: EmailTemplateName
  /** Rendered HTML for the email body — kept in the caller so the dispatcher
   *  doesn't need to know about presentation. */
  emailHtml?: string
  /** Free-form disclosure metadata (dayCount, daysSinceLastReading, etc). */
  metadata?: Record<string, unknown>
}

/**
 * N2 (2026-07-13) — reminder dispatcher. Fans one message out across the
 * patient's chosen channels, mirroring the gap-alert / monthly-reask pattern:
 *
 *   • DASHBOARD → Notification row (bell surface).
 *   • PUSH      → Notification row; the notification.create Prisma extension
 *                 auto-fires WebPushService.send via an event listener
 *                 (backend/src/push/web-push.service.ts:117-126).
 *   • EMAIL     → Notification row PLUS EmailService.sendEmail (transport +
 *                 §164.528 disclosure trail).
 *   • SMS       → no-op with a TODO for Lakshitha's L5. Once the enum
 *                 gains the value AND SmsService lands, replace with a
 *                 Notification.create + SmsService.send pair.
 *
 * Every branch swallows its own errors so one dead channel cannot starve the
 * others — the same principle the audit-write pipeline uses (N1).
 */
@Injectable()
export class ReminderDispatcherService {
  private readonly logger = new Logger(ReminderDispatcherService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    private readonly encryption: EncryptionService,
    private readonly config: ConfigService,
  ) {}

  async dispatch(
    recipient: ReminderRecipient,
    payload: ReminderPayload,
    channels: readonly ReminderChannel[],
  ): Promise<void> {
    for (const ch of channels) {
      try {
        if (ch === 'DASHBOARD') await this.sendDashboard(recipient, payload)
        else if (ch === 'PUSH') await this.sendPush(recipient, payload)
        else if (ch === 'EMAIL') await this.sendEmail(recipient, payload)
        else if (ch === 'SMS') await this.sendSms(recipient)
      } catch (err) {
        this.logger.error(
          `Reminder dispatch failed on ${ch} for user=${recipient.userId}`,
          err instanceof Error ? err.stack : String(err),
        )
      }
    }
  }

  private async sendDashboard(r: ReminderRecipient, p: ReminderPayload): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId: r.userId,
        patientUserId: r.patientUserId ?? null,
        channel: NotificationChannel.DASHBOARD,
        title: p.title,
        body: p.body,
        dispatchTrigger: 'SYSTEM_CRON',
      },
    })
  }

  private async sendPush(r: ReminderRecipient, p: ReminderPayload): Promise<void> {
    // Creating a PUSH-channel Notification triggers the push-dispatch Prisma
    // extension → WebPushService.send via an OnEvent listener. Do not call
    // web-push directly here or the same message goes out twice.
    await this.prisma.notification.create({
      data: {
        userId: r.userId,
        patientUserId: r.patientUserId ?? null,
        channel: NotificationChannel.PUSH,
        title: p.title,
        body: p.body,
        dispatchTrigger: 'SYSTEM_CRON',
      },
    })
  }

  private async sendEmail(r: ReminderRecipient, p: ReminderPayload): Promise<void> {
    if (!r.email) return // invited-but-not-activated rows can lack an email
    await this.prisma.notification.create({
      data: {
        userId: r.userId,
        patientUserId: r.patientUserId ?? null,
        channel: NotificationChannel.EMAIL,
        title: p.title,
        body: p.body,
        dispatchTrigger: 'SYSTEM_CRON',
      },
    })
    await this.emailService.sendEmail(
      r.email,
      `Cardioplace: ${p.title}`,
      p.emailHtml ?? renderPlainEmail(r.name, p.body),
      {
        template: p.emailTemplate,
        templateVersion: EMAIL_TEMPLATE_VERSION,
        patientUserId: r.patientUserId ?? r.userId,
        metadata: p.metadata,
      },
    )
  }

  /**
   * L5 — SMS reminder. Mirrors sendEmail: a Notification row (the §164.528 send
   * record) plus the transport call, both inside dispatch()'s per-channel
   * try/catch so a Twilio outage can never break the reminder or starve the
   * other channels.
   *
   * DELIBERATELY NOT re-checked here (the cron already gated them BEFORE
   * calling dispatch, and the integration contract says do not duplicate):
   *   • hasLoggedReadingToday  → suppression
   *   • isWithinQuietHours     → quiet hours
   * SMS therefore fires at the exact same moment, under the exact same rules,
   * as the in-app/push/email reminder.
   *
   * The gates that ARE ours: flag → phone → consent → not-opted-out.
   */
  private async sendSms(r: ReminderRecipient): Promise<void> {
    // L10 kill-switch FIRST — when SMS is off we do zero work (not even a
    // lookup), so the flag cannot affect any other channel or feature.
    if (!this.smsService.isEnabled()) return

    const user = await this.prisma.user.findUnique({
      where: { id: r.userId },
      select: {
        phoneNumber: true,
        smsConsent: true,
        smsOptedOut: true,
        preferredLanguage: true,
      },
    })
    if (!user?.phoneNumber) return // no number → nothing to send to
    if (!user.smsConsent) return // opt-in only — never send without consent
    // L7 — honour our own opt-out record. Twilio also blocks STOP at the
    // carrier, but we must never rely on the provider alone.
    if (user.smsOptedOut) return

    // Stored as an AES-256-GCM envelope; decrypt only here, on the send path.
    let phone: string
    try {
      phone = this.encryption.decrypt(user.phoneNumber)
    } catch {
      // Never log the ciphertext or any fragment of the number.
      this.logger.error(`SMS skipped — undecryptable phone for user=${r.userId}`)
      return
    }

    // L6 — PHI-free directional copy in the patient's language. NOTE: we do NOT
    // use payload.body — that carries the patient's name and the escalating
    // Day-2/Day-3 tone. SMS never escalates and never carries clinical content.
    const body = smsReminderBody(
      resolveSmsLanguage(user.preferredLanguage),
      this.checkInLink(),
    )

    await this.prisma.notification.create({
      data: {
        userId: r.userId,
        patientUserId: r.patientUserId ?? null,
        channel: NotificationChannel.SMS,
        // Title is internal-only (SMS has no subject); the body stored is the
        // exact PHI-free text we sent, so the record is auditable.
        title: 'SMS reminder',
        body,
        dispatchTrigger: 'SYSTEM_CRON',
      },
    })
    await this.smsService.sendSms(phone, body, SMS_REMINDER_TEMPLATE_ID)
  }

  /** Deep link into the patient app's check-in. WEB_APP_URL may hold a
   *  comma-separated pair (patient,admin) — the patient app is first. */
  private checkInLink(): string {
    const base = (
      this.config.get<string>('WEB_APP_URL', 'http://localhost:3000') ?? ''
    )
      .split(',')[0]!
      .trim()
      .replace(/\/$/, '')
    return `${base}/check-in`
  }
}

function renderPlainEmail(name: string, body: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2>Hi ${escapeHtml(name)},</h2>
      <p>${escapeHtml(body)}</p>
      <p>Log in to Cardioplace to enter your reading.</p>
    </div>
  `
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
