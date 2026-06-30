import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import nodemailer, { type Transporter } from 'nodemailer'

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name)
  private readonly transporter: Transporter
  private readonly from: string

  constructor(private readonly config: ConfigService) {
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

    // SMTP_FROM is the canonical sender; fall back to the legacy EMAIL_FROM for
    // back-compat. NOTE: the address must be one the SMTP server is authorised
    // to send as (the authenticated user or a configured alias) or the message
    // will be rejected / rewritten.
    this.from =
      this.config.get<string>('SMTP_FROM') ??
      this.config.get<string>('EMAIL_FROM', 'Cardioplace <no-reply@cardioplace.ai>')
  }

  // Non-fatal reachability check at boot so bad SMTP creds surface in the logs
  // immediately instead of on the first send. Never throws — the app must still
  // start even if the mail server is briefly unreachable.
  async onModuleInit(): Promise<void> {
    try {
      await this.transporter.verify()
      this.logger.log('SMTP transport verified — ready to send')
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
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
      })
      this.logger.log(
        `Email sent to ${to} — id: ${info.messageId} — subject: ${subject}`,
      )
    } catch (error) {
      this.logger.error(
        `Email failed for ${to}`,
        error instanceof Error ? error.message : error,
      )
    }
  }
}
