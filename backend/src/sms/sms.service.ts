import { Injectable, Logger } from '@nestjs/common'

/**
 * Gap 5 — swappable SMS abstraction.
 *
 * No SMS provider (Twilio, etc.) is wired for the pilot. This is the seam: a
 * real provider implementation replaces the body of `sendSms` later without
 * touching callers (EscalationService.dispatchCaregiverNotification). Until
 * then a caregiver set to notifyChannel=SMS is captured but NOT delivered —
 * `isConfigured()` is false and `sendSms` throws so the dispatcher logs and
 * skips rather than silently dropping.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name)

  /** True once a real provider is wired (env-driven). False for the pilot. */
  isConfigured(): boolean {
    return false
  }

  async sendSms(to: string, body: string): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.warn(
        `SMS not configured — dropping message to ${maskPhone(to)} (${body.length} chars)`,
      )
      throw new Error('SMS not configured')
    }
    // Real provider call goes here when SMS is wired.
  }
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '***'
  return `***${phone.slice(-4)}`
}
