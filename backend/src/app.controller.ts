import { Body, Controller, Get, Post } from "@nestjs/common";
import { AppService } from "./app.service.js";
import { EmailService } from "./email/email.service.js";
import { EMAIL_TEMPLATE_VERSION, contactFormEmailHtml } from "./email/email-templates.js";
import { Public } from "./auth/decorators/public.decorator.js";

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly emailService: EmailService,
  ) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Post('contact')
  async contact(
    @Body() body: { email: string; message: string },
  ) {
    const { email, message } = body;
    // N6 — contact form is anonymous submitter → ops inbox. Content COULD
    // reference a specific patient, so classify PHI-adjacent (patientUserId
    // NULL because we can't link the submitter identity to a User row).
    await this.emailService.sendEmail(
      'info@healplace.com',
      `Cardioplace — New message from ${email}`,
      contactFormEmailHtml(email, message),
      {
        template: 'contact_form',
        templateVersion: EMAIL_TEMPLATE_VERSION,
        patientUserId: null,
        metadata: { submitterEmail: email },
      },
    );
    return { statusCode: 200, message: 'Message sent' };
  }
}
