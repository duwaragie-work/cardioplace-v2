import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import nodemailer, { type Transporter } from 'nodemailer'

/**
 * Two transports, picked at boot:
 *   • RESEND_API_KEY set → send over Resend's HTTPS API (port 443). Required on
 *     hosts that block outbound SMTP (Railway Hobby blocks ports 25/465/587 with
 *     no override), so raw SMTP times out there. The sender domain must be
 *     verified in the Resend account or Resend rejects the send.
 *   • otherwise → nodemailer SMTP (local dev / any host that allows SMTP egress).
 * The selection is implicit (key present → Resend) so prod sets the key and
 * local keeps using SMTP unchanged.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name)
  private readonly transporter: Transporter | null
  private readonly resendApiKey: string | undefined
  private readonly from: string

  constructor(private readonly config: ConfigService) {
    this.resendApiKey = this.config.get<string>('RESEND_API_KEY') || undefined

    // SMTP_FROM is the canonical sender; fall back to the legacy EMAIL_FROM for
    // back-compat. NOTE: the address must be one the transport is authorised to
    // send as — the authenticated SMTP user/alias, OR a Resend-verified domain —
    // or the message is rejected / rewritten.
    this.from =
      this.config.get<string>('SMTP_FROM') ??
      this.config.get<string>('EMAIL_FROM', 'Cardioplace <no-reply@cardioplace.ai>')

    if (this.resendApiKey) {
      // HTTP transport — no SMTP socket needed.
      this.transporter = null
    } else {
      const host = this.config.get<string>('SMTP_HOST')
      const port = Number(this.config.get<string>('SMTP_PORT', '587'))
      const user = this.config.get<string>('SMTP_USER')
      const pass = this.config.get<string>('SMTP_PASS')

      this.transporter = nodemailer.createTransport({
        host,
        port,
        // 465 → implicit TLS; 587 (and others) → STARTTLS, which nodemailer
        // negotiates automatically.
        secure: port === 465,
        auth: user ? { user, pass } : undefined,
      })
    }
  }

  // Non-fatal reachability check at boot so a misconfigured transport surfaces
  // in the logs immediately instead of on the first send. Never throws — the app
  // must still start even if the mail server is briefly unreachable.
  async onModuleInit(): Promise<void> {
    if (this.resendApiKey) {
      this.logger.log('Email transport: Resend HTTPS API (RESEND_API_KEY set)')
      return
    }
    try {
      await this.transporter!.verify()
      this.logger.log('Email transport: SMTP — verified, ready to send')
    } catch (error) {
      this.logger.warn(
        `SMTP transport verify failed (emails may not send): ${
          error instanceof Error ? error.message : error
        }`,
      )
    }
  }

  // Fire-and-forget: callers (OTP, welcome, escalation, …) `void`-dispatch this
  // and rely on it never throwing. Failures are logged, not propagated.
  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    try {
      if (this.resendApiKey) {
        await this.sendViaResend(to, subject, html)
      } else if (this.transporter) {
        const info = await this.transporter.sendMail({
          from: this.from,
          to,
          subject,
          html,
        })
        this.logger.log(
          `Email sent to ${to} — id: ${info.messageId} — subject: ${subject}`,
        )
      } else {
        this.logger.error(`Email failed for ${to}: no transport configured`)
      }
    } catch (error) {
      this.logger.error(
        `Email failed for ${to}`,
        error instanceof Error ? error.message : error,
      )
    }
  }

  // Resend HTTPS API — works on hosts that block outbound SMTP. Uses global
  // fetch (Node 18+); no SDK dependency. Throws on a non-2xx so the caller's
  // catch logs it (callers stay fire-and-forget).
  private async sendViaResend(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: this.from, to, subject, html }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`)
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string }
    this.logger.log(
      `Email sent to ${to} via Resend — id: ${data.id ?? '?'} — subject: ${subject}`,
    )
  }
}
