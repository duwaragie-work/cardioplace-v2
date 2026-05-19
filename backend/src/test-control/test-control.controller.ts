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

  @Post('retry-event/backdate')
  @HttpCode(200)
  async backdateRetryEvent(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { alertId: string; deltaSeconds: number },
  ) {
    this.assertAuthorized(secret)
    await this.svc.backdateRetryEvent(body.alertId, body.deltaSeconds)
    return { ok: true }
  }

  // Cluster 7 C.1 — drive the ladder forward without waiting for the cron or
  // the business-hours guard. Inserts already-dispatched EscalationEvent rows
  // for steps[1..n] using the alert's createdAt anchor.
  @Post('escalation/advance-ladder-steps')
  @HttpCode(200)
  async advanceLadderSteps(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { alertId: string; n: number },
  ) {
    this.assertAuthorized(secret)
    return this.svc.advanceLadderSteps(body.alertId, body.n)
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

  @Post('medications/backdate-all-for-user')
  @HttpCode(200)
  async backdateAllUserMedications(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { userId: string; deltaSeconds: number },
  ) {
    this.assertAuthorized(secret)
    return this.svc.backdateAllUserMedications(body.userId, body.deltaSeconds)
  }

  @Post('user/backdate-updated-at')
  @HttpCode(200)
  async backdateUserUpdatedAt(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { userId: string; deltaSeconds: number },
  ) {
    this.assertAuthorized(secret)
    await this.svc.backdateUserUpdatedAt(body.userId, body.deltaSeconds)
    return { ok: true }
  }

  // Cluster 8 — backdate User.enrolledAt for Q2 ramp + Q3 nudge personas.
  @Post('user/backdate-enrolled-at')
  @HttpCode(200)
  async backdateEnrolledAt(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { userId: string; deltaSeconds: number },
  ) {
    this.assertAuthorized(secret)
    await this.svc.backdateEnrolledAt(body.userId, body.deltaSeconds)
    return { ok: true }
  }

  @Post('journal/seed-at-time')
  @HttpCode(200)
  async seedReadingsAtTime(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: {
      userId: string
      readings: Array<{
        measuredAt: string
        systolicBP: number
        diastolicBP: number
        pulse: number
        sessionId?: string
      }>
    },
  ) {
    this.assertAuthorized(secret)
    return this.svc.seedReadingsAtTime(body.userId, body.readings)
  }

  @Post('user/set-condition')
  @HttpCode(200)
  async setUserCondition(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: {
      userId: string
      flag:
        | 'isPregnant'
        | 'historyPreeclampsia'
        | 'hasHeartFailure'
        | 'hasAFib'
        | 'hasCAD'
        | 'hasHCM'
        | 'hasDCM'
        | 'hasBradycardia'
        | 'hasTachycardia'
        | 'diagnosedHypertension'
      value: boolean
      heartFailureType?: 'HFREF' | 'HFPEF' | 'UNKNOWN' | 'NOT_APPLICABLE'
    },
  ) {
    this.assertAuthorized(secret)
    await this.svc.setUserCondition(
      body.userId,
      body.flag,
      body.value,
      body.heartFailureType,
    )
    return { ok: true }
  }

  @Post('user/set-medication')
  @HttpCode(200)
  async setUserMedication(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: {
      userId: string
      med: {
        drugName: string
        drugClass: string
        frequency: 'ONCE_DAILY' | 'TWICE_DAILY' | 'THREE_TIMES_DAILY' | 'AS_NEEDED' | 'UNSURE'
        verificationStatus?: 'VERIFIED' | 'UNVERIFIED'
      }
    },
  ) {
    this.assertAuthorized(secret)
    return this.svc.setUserMedication(body.userId, body.med)
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

  // Phase 4 §C — auth-onboarding spec (20a) onboarding-state control.
  @Post('user/set-onboarding-status')
  @HttpCode(200)
  async setOnboardingStatus(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { userId: string; status: 'NOT_COMPLETED' | 'COMPLETED' },
  ) {
    this.assertAuthorized(secret)
    await this.svc.setOnboardingStatus(body.userId, body.status)
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

  // Phase 4 §B.2 — age-bucket boundary tests (spec 20g.1).
  @Post('user/set-date-of-birth')
  @HttpCode(200)
  async setUserDateOfBirth(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { userId: string; dob: string },
  ) {
    this.assertAuthorized(secret)
    await this.svc.setUserDateOfBirth(body.userId, new Date(body.dob))
    return { ok: true }
  }

  // Phase 4 §B.2 — personalized-mode threshold tests (spec 20g.21–22).
  @Post('user/set-threshold')
  @HttpCode(200)
  async setPatientThreshold(
    @Headers('x-test-control-secret') secret: string,
    @Body()
    body: {
      userId: string
      override: {
        sbpUpperTarget?: number
        sbpLowerTarget?: number
        dbpUpperTarget?: number
        dbpLowerTarget?: number
      }
    },
  ) {
    this.assertAuthorized(secret)
    return this.svc.setPatientThreshold(body.userId, body.override ?? {})
  }


  // ─── Seed fixtures (Phase 0 §H) ─────────────────────────────────────────
  @Post('user/set-account-status')
  @HttpCode(200)
  async setAccountStatus(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { email: string; status: 'ACTIVE' | 'BLOCKED' | 'SUSPENDED' },
  ) {
    this.assertAuthorized(secret)
    return this.svc.setAccountStatus(body.email, body.status)
  }

  @Post('seed/alerts')
  @HttpCode(200)
  async seedAlerts(
    @Headers('x-test-control-secret') secret: string,
    @Body()
    body: {
      userId: string
      alerts: Array<{
        tier: string
        status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
        ruleId?: string
        createdAtIso?: string
        acknowledgedByUserId?: string
        resolvedBy?: string
        resolutionAction?: string
        resolutionRationale?: string
      }>
    },
  ) {
    this.assertAuthorized(secret)
    return this.svc.seedAlerts(body.userId, body.alerts ?? [])
  }

  @Post('seed/notifications')
  @HttpCode(200)
  async seedNotifications(
    @Headers('x-test-control-secret') secret: string,
    @Body()
    body: {
      userId: string
      count: number
      channel?: 'PUSH' | 'EMAIL' | 'PHONE' | 'DASHBOARD'
    },
  ) {
    this.assertAuthorized(secret)
    return this.svc.seedNotifications(body.userId, body.count, body.channel)
  }

  @Post('seed/audit-trail')
  @HttpCode(200)
  async seedAuditTrail(
    @Headers('x-test-control-secret') secret: string,
    @Body()
    body: {
      userId: string
      events: Array<{
        changeType: string
        fieldPath: string
        changedBy: string
        changedByRole?: 'PATIENT' | 'ADMIN' | 'PROVIDER'
        previousValue?: unknown
        newValue?: unknown
        rationale?: string
        discrepancyFlag?: boolean
        createdAtIso?: string
      }>
    },
  ) {
    this.assertAuthorized(secret)
    return this.svc.seedAuditTrail(body.userId, body.events ?? [])
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

  // Spec 12 — drive the enrollment-gate "practice-missing-business-hours"
  // failure path. Clears the three businessHours fields on the practice
  // linked to `userId` via PatientProviderAssignment; returns the prior
  // values so tests can restore them via /practice/restore-business-hours.
  @Post('practice/clear-business-hours')
  @HttpCode(200)
  async clearPracticeBusinessHours(
    @Headers('x-test-control-secret') secret: string,
    @Body() body: { userId: string },
  ) {
    this.assertAuthorized(secret)
    return this.svc.clearPracticeBusinessHours(body.userId)
  }

  @Post('practice/restore-business-hours')
  @HttpCode(200)
  async restorePracticeBusinessHours(
    @Headers('x-test-control-secret') secret: string,
    @Body()
    body: {
      userId: string
      businessHoursStart: string
      businessHoursEnd: string
      businessHoursTimezone: string
    },
  ) {
    this.assertAuthorized(secret)
    return this.svc.restorePracticeBusinessHours(body)
  }
}
