import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { RolesGuard } from '../auth/guards/roles.guard.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ProviderService } from './provider.service.js'

type AuthedReq = Request & { user: { id: string; roles: UserRole[] } }

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
  ) {}

  @Get('stats')
  getStats() {
    return this.providerService.getStats()
  }

  @Get('patients')
  getPatients(
    @Req() req: AuthedReq,
    @Query('riskTier') riskTier?: string,
    @Query('hasActiveAlerts') hasActiveAlerts?: string,
    @Query('scope') scope?: string,
  ) {
    return this.providerService.getPatients({
      riskTier,
      hasActiveAlerts:
        hasActiveAlerts === 'true'
          ? true
          : hasActiveAlerts === 'false'
            ? false
            : undefined,
      // PROVIDER-only scoping: pass scope=assigned to limit the result to
      // patients whose primary or backup provider is the caller. Always
      // applied for PROVIDER role even if the client doesn't request it,
      // so a misconfigured frontend can't accidentally leak the full list.
      scope: this.resolveScope(req, scope),
      callerUserId: req.user.id,
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
    @Query('scope') scope?: string,
  ) {
    return this.providerService.getAlerts({
      severity,
      escalated:
        escalated === 'true'
          ? true
          : escalated === 'false'
            ? false
            : undefined,
      scope: this.resolveScope(req, scope),
      callerUserId: req.user.id,
    })
  }

  /**
   * PROVIDER role is always force-scoped to their own assignments — the
   * frontend can ask for `scope=assigned` explicitly, but even if it asks
   * for `all` we override so a misconfigured caller can't leak data.
   * Other admin roles can opt in to `assigned` if a future UI surfaces a
   * "my patients" view, otherwise default `all`.
   */
  private resolveScope(req: AuthedReq, requested?: string): 'all' | 'assigned' {
    const ADMIN_ROLES: UserRole[] = [
      UserRole.SUPER_ADMIN,
      UserRole.MEDICAL_DIRECTOR,
      UserRole.HEALPLACE_OPS,
    ]
    const isProviderOnly =
      req.user.roles.includes(UserRole.PROVIDER) &&
      !req.user.roles.some((r) => ADMIN_ROLES.includes(r))
    if (isProviderOnly) return 'assigned'
    return requested === 'assigned' ? 'assigned' : 'all'
  }

  /**
   * Authorization gate for per-patient PHI reads (Phase 1 Finding 1+2 — P0).
   * resolveScope() only protects the list endpoints; the per-patient /
   * per-alert endpoints took a raw id with NO assignment and NO practice
   * scope, so any clinical-staff user could read any patient's audit PHI by
   * id. This enforces, against the patient's care-team assignment(s):
   *   • requester views their own record                          → allow
   *   • SUPER_ADMIN / HEALPLACE_OPS (org-wide compliance access)   → allow
   *   • PROVIDER — primary OR backup on any of the patient's
   *     assignments                                                → allow
   *   • MEDICAL_DIRECTOR — named MD on any of the patient's
   *     assignments, OR MD for a practice the patient is in        → allow
   *   • everyone else                                              → deny
   *
   * Iterates ALL of the patient's assignments. Today
   * PatientProviderAssignment.userId is @unique (exactly one row), but
   * multi-practice is a planned post-pilot phase — looping now avoids
   * re-touching this security guard later.
   */
  private async canViewPatient(
    user: { id: string; roles: UserRole[] },
    patientUserId: string,
  ): Promise<boolean> {
    if (user.id === patientUserId) return true
    if (
      user.roles.includes(UserRole.SUPER_ADMIN) ||
      user.roles.includes(UserRole.HEALPLACE_OPS)
    ) {
      return true
    }

    const assignments = await this.prisma.patientProviderAssignment.findMany({
      where: { userId: patientUserId },
      select: {
        practiceId: true,
        primaryProviderId: true,
        backupProviderId: true,
        medicalDirectorId: true,
      },
    })
    if (assignments.length === 0) return false

    if (
      user.roles.includes(UserRole.PROVIDER) &&
      assignments.some(
        (a) =>
          a.primaryProviderId === user.id || a.backupProviderId === user.id,
      )
    ) {
      return true
    }

    if (user.roles.includes(UserRole.MEDICAL_DIRECTOR)) {
      // Direct: MD named on one of the patient's own assignments.
      if (assignments.some((a) => a.medicalDirectorId === user.id)) return true
      // Practice-wide: this MD is medical director for ≥1 assignment in a
      // practice the patient is also assigned to (the "same practice →
      // allowed" rule; Practice has no MD FK so it's evidenced via
      // assignments).
      const practiceIds = Array.from(
        new Set(assignments.map((a) => a.practiceId)),
      )
      const mdInPractice = await this.prisma.patientProviderAssignment.count({
        where: {
          medicalDirectorId: user.id,
          practiceId: { in: practiceIds },
        },
      })
      if (mdInPractice > 0) return true
    }

    return false
  }

  private async assertCanViewPatient(
    req: AuthedReq,
    patientUserId: string,
  ): Promise<void> {
    if (!(await this.canViewPatient(req.user, patientUserId))) {
      throw new ForbiddenException('Not authorized to view this patient')
    }
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
  acknowledgeAlert(
    @Req() req: AuthedReq,
    @Param('alertId') alertId: string,
  ) {
    // Phase 1 polish Finding 1+3 — thread the acting clinician so the ack
    // writes DeviationAlert.acknowledgedByUserId + propagates the actor to
    // the EscalationEvent rows (was: anonymous, no propagation).
    return this.providerService.acknowledgeAlert(alertId, req.user.id)
  }

  @Get('scheduled-calls')
  getScheduledCalls(@Query('status') status?: string) {
    return this.providerService.getScheduledCalls({ status })
  }

  @Post('schedule-call')
  scheduleCall(
    @Body()
    body: {
      patientUserId: string
      alertId?: string
      callDate: string
      callTime: string
      callType: string
      notes?: string
    },
  ) {
    return this.providerService.scheduleCall(body)
  }

  @Patch('scheduled-calls/:id/status')
  updateCallStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.providerService.updateCallStatus(id, status)
  }

  @Delete('scheduled-calls/:id')
  deleteScheduledCall(@Param('id') id: string) {
    return this.providerService.deleteScheduledCall(id)
  }
}
