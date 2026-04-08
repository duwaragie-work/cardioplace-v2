import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Resend } from 'resend'

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name)
  private readonly resend: Resend
  private readonly from: string

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(this.config.get<string>('RESEND_API_KEY'))
    this.from = this.config.get<string>(
      'EMAIL_FROM',
      'Cardioplace <onboarding@resend.dev>',
    )
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.resend.emails.send({ from: this.from, to, subject, html })
      this.logger.log(`Email sent to ${to} — subject: ${subject}`)
    } catch (error) {
      this.logger.error(
        `Email failed for ${to}`,
        error instanceof Error ? error.message : error,
      )
    }
  }
}
