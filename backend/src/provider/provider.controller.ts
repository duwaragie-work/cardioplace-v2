import {
  Body,
  Controller,
  Delete,
  Get,
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
  constructor(private readonly providerService: ProviderService) {}

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
  getPatientSummary(@Param('userId') userId: string) {
    return this.providerService.getPatientSummary(userId)
  }

  @Get('patients/:userId/journal')
  getPatientJournal(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = Math.max(1, parseInt(page ?? '1', 10) || 1)
    const l = Math.min(50, Math.max(1, parseInt(limit ?? '10', 10) || 10))
    return this.providerService.getPatientJournal(userId, p, l)
  }

  @Get('patients/:userId/bp-trend')
  getPatientBpTrend(
    @Param('userId') userId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.providerService.getPatientBpTrend(userId, startDate, endDate)
  }

  @Get('patients/:userId/alerts')
  getPatientAlerts(
    @Param('userId') userId: string,
    @Query('status') status?: string,
    @Query('tier') tier?: string,
  ) {
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

  @Get('alerts/:alertId/detail')
  getAlertDetail(@Param('alertId') alertId: string) {
    return this.providerService.getAlertDetail(alertId)
  }

  @Patch('alerts/:alertId/acknowledge')
  acknowledgeAlert(@Param('alertId') alertId: string) {
    return this.providerService.acknowledgeAlert(alertId)
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
