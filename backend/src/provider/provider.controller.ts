import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import { UserRole } from '../generated/prisma/enums.js'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { PatientAccessService } from '../common/patient-access.service.js'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { RolesGuard } from '../auth/guards/roles.guard.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ProviderService } from './provider.service.js'

type AuthedReq = Request & {
  user: { id: string; roles: UserRole[]; activePracticeId?: string | null }
}

// Admin-app dashboard endpoints. All four clinical-staff roles need read
// access — PROVIDER + MEDICAL_DIRECTOR + HEALPLACE_OPS + SUPER_ADMIN. Per-
// role write restrictions are enforced on more specific endpoints
// (thresholds = MD-only, practice CRUD = SUPER_ADMIN/MD/OPS, etc.).
// PROVIDER patient/alert visibility is further scoped by ?scope=assigned —
// see provider.service.ts.
@Controller('provider')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.MEDICAL_DIRECTOR,
  UserRole.PROVIDER,
  UserRole.HEALPLACE_OPS,
)
export class ProviderController {
  constructor(
    private readonly providerService: ProviderService,
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
  ) {}

  @Get('stats')
  getStats(@Req() req: AuthedReq) {
    return this.providerService.getStats({
      id: req.user.id,
      roles: req.user.roles,
      activePracticeId: req.user.activePracticeId,
    })
  }

  @Get('patients')
  getPatients(
    @Req() req: AuthedReq,
    @Query('riskTier') riskTier?: string,
    @Query('hasActiveAlerts') hasActiveAlerts?: string,
  ) {
    return this.providerService.getPatients({
      riskTier,
      hasActiveAlerts:
        hasActiveAlerts === 'true'
          ? true
          : hasActiveAlerts === 'false'
            ? false
            : undefined,
      // Pass through actor (id + roles). The scope filter is derived inside
      // PatientAccessService — PROVIDER ⇒ panel, MED_DIR ⇒ practice,
      // OPS/SUPER ⇒ unfiltered. A misconfigured frontend can't widen scope.
      actor: {
        id: req.user.id,
        roles: req.user.roles,
        activePracticeId: req.user.activePracticeId,
      },
    })
  }

  @Get('patients/:userId/summary')
  async getPatientSummary(
    @Req() req: AuthedReq,
    @Param('userId') userId: string,
  ) {
    await this.assertCanViewPatient(req, userId)
    return this.providerService.getPatientSummary(userId)
  }

  @Get('patients/:userId/journal')
  async getPatientJournal(
    @Req() req: AuthedReq,
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    await this.assertCanViewPatient(req, userId)
    const p = Math.max(1, parseInt(page ?? '1', 10) || 1)
    // Cap raised from 50 → 200 so the patient-detail Readings tab can
    // render a longer history in one page without paging UI.
    const l = Math.min(200, Math.max(1, parseInt(limit ?? '50', 10) || 50))
    return this.providerService.getPatientJournal(userId, p, l)
  }

  @Get('patients/:userId/rejected-readings')
  async getPatientRejectedReadings(
    @Req() req: AuthedReq,
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
  ) {
    await this.assertCanViewPatient(req, userId)
    const l = Math.min(100, Math.max(1, parseInt(limit ?? '20', 10) || 20))
    return this.providerService.getPatientRejectedReadings(userId, l)
  }

  @Get('patients/:userId/bp-trend')
  async getPatientBpTrend(
    @Req() req: AuthedReq,
    @Param('userId') userId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    await this.assertCanViewPatient(req, userId)
    return this.providerService.getPatientBpTrend(userId, startDate, endDate)
  }

  @Get('patients/:userId/alerts')
  async getPatientAlerts(
    @Req() req: AuthedReq,
    @Param('userId') userId: string,
    @Query('status') status?: string,
    @Query('tier') tier?: string,
  ) {
    await this.assertCanViewPatient(req, userId)
    return this.providerService.getPatientAlerts(userId, { status, tier })
  }

  @Get('alerts')
  getAlerts(
    @Req() req: AuthedReq,
    @Query('severity') severity?: string,
    @Query('escalated') escalated?: string,
  ) {
    return this.providerService.getAlerts({
      severity,
      escalated:
        escalated === 'true'
          ? true
          : escalated === 'false'
            ? false
            : undefined,
      actor: {
        id: req.user.id,
        roles: req.user.roles,
        activePracticeId: req.user.activePracticeId,
      },
    })
  }

  /**
   * Per-patient PHI read gate (Phase 1 Finding 1+2 — P0). Delegates to
   * PatientAccessService so this controller picks up the same scope rules
   * the patient-detail mutations use — including the May 2026 switch to
   * MED_DIR scoping via the PracticeMedicalDirector join (a MD heads
   * practices first-class, not derived from assignment.medicalDirectorId).
   * The patient-views-self short-circuit stays here because PatientAccess-
   * Service only handles admin-role callers.
   */
  private async assertCanViewPatient(
    req: AuthedReq,
    patientUserId: string,
  ): Promise<void> {
    if (req.user.id === patientUserId) return
    await this.access.assertCanAccessPatient(
      {
        id: req.user.id,
        roles: req.user.roles,
        activePracticeId: req.user.activePracticeId,
      },
      patientUserId,
    )
  }

  @Get('alerts/:alertId/detail')
  async getAlertDetail(
    @Req() req: AuthedReq,
    @Param('alertId') alertId: string,
  ) {
    // Resolve alert → owning patient, then apply the same assignment+practice
    // gate. NotFound (not Forbidden) when the alert doesn't exist so we don't
    // leak which ids are valid.
    const alert = await this.prisma.deviationAlert.findUnique({
      where: { id: alertId },
      select: { userId: true },
    })
    if (!alert) throw new NotFoundException('Alert not found')
    await this.assertCanViewPatient(req, alert.userId)
    return this.providerService.getAlertDetail(alertId)
  }

  @Patch('alerts/:alertId/acknowledge')
  async acknowledgeAlert(
    @Req() req: AuthedReq,
    @Param('alertId') alertId: string,
  ) {
    // V-04 (Humaira assessment 2026-07-14, HIGH) — this WRITE path had no scope
    // check while its read sibling getAlertDetail (directly above) did. Any
    // authenticated provider could acknowledge another practice's alert: it
    // makes an unaddressed patient-safety alert look handled AND stamps their
    // own id as the actor, poisoning the escalation audit trail.
    //
    // "Phase 1 polish Finding 1+3" threaded req.user.id through for
    // attribution — but attribution is not authorization; the gate below is.
    // Same shape as getAlertDetail, incl. 404-before-403 so ids don't leak.
    const alert = await this.prisma.deviationAlert.findUnique({
      where: { id: alertId },
      select: { userId: true },
    })
    if (!alert) throw new NotFoundException('Alert not found')
    await this.assertCanViewPatient(req, alert.userId)
    return this.providerService.acknowledgeAlert(alertId, req.user.id)
  }

}
