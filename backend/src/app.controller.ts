import { Body, Controller, Get, Post } from "@nestjs/common";
import { AppService } from "./app.service.js";
import { EmailService } from "./email/email.service.js";
import { contactFormEmailHtml } from "./email/email-templates.js";
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
    await this.emailService.sendEmail(
      'info@healplace.com',
      `Cardioplace — New message from ${email}`,
      contactFormEmailHtml(email, message),
    );
    return { statusCode: 200, message: 'Message sent' };
  }
}
