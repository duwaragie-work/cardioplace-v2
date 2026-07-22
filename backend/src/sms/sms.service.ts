import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash } from 'crypto'
import twilio from 'twilio'

/**
 * SMS transport (L2 / L9 / L10, 2026-07-14). Was the Gap-5 no-op seam; now a
 * real Twilio implementation. Callers are unchanged.
 *
 * Outbound only — no inbound webhook processing for MVP. Sends via a Twilio
 * MESSAGING SERVICE (not the raw from-number API) so Twilio manages the sender
 * ID and honours STOP at the carrier level. We still refuse to send to an
 * opted-out patient ourselves (see ReminderDispatcherService) — never trust the
 * provider alone.
 *
 * Configured implicitly from env, mirroring EmailService / WebPushService. TWO
 * independent switches, BOTH required to send:
 *   • SMS_REMINDERS_ENABLED (L10) — the product kill-switch. Default OFF, so
 *     SMS ships dark until counsel signs off. Flipping it cannot affect any
 *     other feature: the dispatcher's SMS branch is its only consumer, and the
 *     branch is skipped wholesale when it's off.
 *   • TWILIO_* credentials — the transport switch.
 *
 * `sendSms` still THROWS when unconfigured — the pre-existing contract this
 * seam was written with (EscalationService.dispatchCaregiverNotification relies
 * on the throw to log-and-skip rather than silently drop a caregiver message),
 * so it is deliberately preserved. The reminder path never relies on it: it
 * checks isEnabled() first, and ReminderDispatcherService.dispatch() wraps every
 * channel in its own try/catch — an SMS failure can never break a reminder or
 * starve the other channels.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name)
  private client: ReturnType<typeof twilio> | null = null

  constructor(private readonly config: ConfigService) {}

  /** True once real Twilio credentials + a Messaging Service are wired. */
  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('TWILIO_ACCOUNT_SID') &&
        this.config.get<string>('TWILIO_AUTH_TOKEN') &&
        this.config.get<string>('TWILIO_MESSAGING_SERVICE_SID'),
    )
  }

  /**
   * L10 — the product kill-switch. `SMS_REMINDERS_ENABLED=true` AND configured
   * credentials are both required before a single message goes out. Default OFF
   * (anything other than the literal 'true' is off), so a deploy that forgets
   * the flag ships SMS dark rather than texting patients by accident.
   */
  isEnabled(): boolean {
    return (
      this.config.get<string>('SMS_REMINDERS_ENABLED') === 'true' &&
      this.isConfigured()
    )
  }

  /**
   * L9 — the sender name patients see.
   *
   * ⚠️ The spec (Part 2C) mandates "Healplace" and explicitly forbids
   * "Cardioplace": naming the cardiac programme on an UNENCRYPTED channel tells
   * anyone who sees the patient's phone that they're in cardiac monitoring. The
   * team overrode this on 2026-07-14 and asked for "Cardioplace", so that is
   * the default here — but kept env-overridable (SMS_SENDER_ID) so it's a
   * one-variable change if counsel pushes back on review question #2.
   *
   * NOTE: the ACTUAL sender rendered on the handset is whatever the Twilio
   * Messaging Service is configured with in the Twilio console. This value is
   * what we assert/label on our side (logs, docs, counsel packet).
   */
  senderId(): string {
    return this.config.get<string>('SMS_SENDER_ID') ?? 'Cardioplace'
  }

  /**
   * Send one SMS. `to` must be E.164 (e.g. +15550100).
   *
   * L8 — logs NEVER contain the plaintext phone number: only a hash of the
   * recipient, the template id, and a byte count.
   */
  async sendSms(to: string, body: string, templateId = 'unknown'): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.warn(
        `SMS not configured — dropping message to ${maskPhone(to)} (${body.length} chars)`,
      )
      throw new Error('SMS not configured')
    }
    const messagingServiceSid = this.config.get<string>(
      'TWILIO_MESSAGING_SERVICE_SID',
    )!
    try {
      await this.getClient().messages.create({ to, body, messagingServiceSid })
      this.logger.log(
        `SMS sent recipient=${hashRecipient(to)} template=${templateId} bytes=${body.length}`,
      )
    } catch (err) {
      // Never log `to` in plaintext, even on failure.
      this.logger.error(
        `SMS send failed recipient=${hashRecipient(to)} template=${templateId}`,
        err instanceof Error ? err.message : String(err),
      )
      throw err instanceof Error ? err : new Error('SMS send failed')
    }
  }

  private getClient(): ReturnType<typeof twilio> {
    if (!this.client) {
      this.client = twilio(
        this.config.get<string>('TWILIO_ACCOUNT_SID')!,
        this.config.get<string>('TWILIO_AUTH_TOKEN')!,
      )
    }
    return this.client
  }
}

/**
 * L8 — stable, non-reversible recipient id for send logs. SHA-256 over the
 * number, truncated: enough to correlate "did this person get it / how often"
 * without ever writing a phone number to stdout or a log sink.
 */
function hashRecipient(phone: string): string {
  return createHash('sha256').update(phone).digest('hex').slice(0, 16)
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '***'
  return `***${phone.slice(-4)}`
}
