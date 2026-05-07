import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common'
import { Public } from '../auth/decorators/public.decorator.js'
import { TestControlService } from './test-control.service.js'

/**
 * Dev-only test-control endpoints. Mounted ONLY when ENABLE_TEST_CONTROL=true
 * (gated in app.module.ts). Optionally protected by a shared secret via
 * TEST_CONTROL_SECRET — when set, every request must include the matching
 * `X-Test-Control-Secret` header.
 *
 * No JWT, no role guard. These are meant to be called from a local Playwright
 * suite or an ops shell, not from the public web. NEVER ship with the env
 * flag on in production.
 */
@Public()
@Controller('test-control')
export class TestControlController {
  private readonly secret: string | null
  private readonly nodeEnv: string

  constructor(private readonly svc: TestControlService) {
    const s = process.env.TEST_CONTROL_SECRET
    this.secret = s && s.length > 0 ? s : null
    this.nodeEnv = process.env.NODE_ENV ?? 'development'
  }

  private assertAuthorized(headerSecret: string | undefined): void {
    if (this.nodeEnv === 'production') {
      throw new ForbiddenException('test-control disabled in production')
    }
    if (process.env.ENABLE_TEST_CONTROL !== 'true') {
      throw new ForbiddenException('test-control: ENABLE_TEST_CONTROL=true required')
    }
    if (this.secret && headerSecret !== this.secret) {
      throw new ForbiddenException('test-control: invalid or missing secret header')
    }
  }

  @Get('health')
  health() {
    return {
      ok: true,
      enableTestControl: process.env.ENABLE_TEST_CONTROL === 'true',
      nodeEnv: this.nodeEnv,
      secretRequired: this.secret !== null,
    }
  }

  // ─── Cron drivers ───────────────────────────────────────────────────────
  @Post('cron/escalation/run')
  @HttpCode(200)
  async runEscalation(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { now?: string },
  ) {
    this.assertAuthorized(secret)
    return this.svc.runEscalationScan(body?.now ? new Date(body.now) : new Date())
  }

  @Post('cron/gap-alert/run')
  @HttpCode(200)
  async runGapAlert(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { now?: string },
  ) {
    this.assertAuthorized(secret)
    return this.svc.runGapAlertScan(body?.now ? new Date(body.now) : new Date())
  }

  @Post('cron/monthly-reask/run')
  @HttpCode(200)
  async runMonthlyReask(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { now?: string },
  ) {
    this.assertAuthorized(secret)
    return this.svc.runMonthlyReaskScan(body?.now ? new Date(body.now) : new Date())
  }

  // ─── Time advancement ───────────────────────────────────────────────────
  @Post('anchor/backdate')
  @HttpCode(200)
  async backdateAnchor(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { alertId: string; deltaSeconds: number },
  ) {
    this.assertAuthorized(secret)
    await this.svc.backdateAlertAnchor(body.alertId, body.deltaSeconds)
    return { ok: true }
  }

  @Post('journal/backdate-latest')
  @HttpCode(200)
  async backdateLastJournalEntry(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { userId: string; deltaSeconds: number },
  ) {
    this.assertAuthorized(secret)
    await this.svc.backdateLastJournalEntry(body.userId, body.deltaSeconds)
    return { ok: true }
  }

  @Post('medication/backdate-verified')
  @HttpCode(200)
  async backdateMedicationVerified(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { medId: string; deltaSeconds: number },
  ) {
    this.assertAuthorized(secret)
    await this.svc.backdateMedicationVerified(body.medId, body.deltaSeconds)
    return { ok: true }
  }

  // ─── Reset ──────────────────────────────────────────────────────────────
  @Post('reset/test-patients')
  @HttpCode(200)
  async resetTestPatients(@Headers('x-test-control-secret') secret: string) {
    this.assertAuthorized(secret)
    return this.svc.resetTestPatients()
  }

  @Post('reset/user')
  @HttpCode(200)
  async resetUser(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { userId: string },
  ) {
    this.assertAuthorized(secret)
    return this.svc.resetUser(body.userId)
  }

  @Post('user/set-enrollment')
  @HttpCode(200)
  async setEnrollment(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { userId: string; status: 'NOT_ENROLLED' | 'ENROLLED' },
  ) {
    this.assertAuthorized(secret)
    await this.svc.setEnrollment(body.userId, body.status)
    return { ok: true }
  }

  @Post('user/set-profile-verification')
  @HttpCode(200)
  async setProfileVerification(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { userId: string; status: 'UNVERIFIED' | 'VERIFIED' | 'CORRECTED' },
  ) {
    this.assertAuthorized(secret)
    await this.svc.setProfileVerificationStatus(body.userId, body.status)
    return { ok: true }
  }

  // ─── Inspection ─────────────────────────────────────────────────────────
  @Get('alerts')
  async listAlerts(
    @Headers('x-test-control-secret') secret: string,
    @Query('userId') userId: string,
  ) {
    this.assertAuthorized(secret)
    return this.svc.listAlerts(userId)
  }

  @Get('escalation-events')
  async listEscalationEvents(
    @Headers('x-test-control-secret') secret: string,
    @Query('alertId') alertId: string,
  ) {
    this.assertAuthorized(secret)
    return this.svc.listEscalationEvents(alertId)
  }

  @Get('notifications')
  async listNotifications(
    @Headers('x-test-control-secret') secret: string,
    @Query('userId') userId: string,
  ) {
    this.assertAuthorized(secret)
    return this.svc.listNotifications(userId)
  }

  @Get('user/find')
  async findUser(
    @Headers('x-test-control-secret') secret: string,
    @Query('email') email: string,
  ) {
    this.assertAuthorized(secret)
    return this.svc.findUser(email)
  }
}
