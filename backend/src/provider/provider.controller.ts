import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { UserRole } from '../generated/prisma/enums.js'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { RolesGuard } from '../auth/guards/roles.guard.js'
import { ProviderService } from './provider.service.js'

@Controller('provider')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class ProviderController {
  constructor(private readonly providerService: ProviderService) {}

  @Get('stats')
  getStats() {
    return this.providerService.getStats()
  }

  @Get('patients')
  getPatients(
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

  @Get('alerts')
  getAlerts(
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
    })
  }

  @Get('alerts/:alertId/detail')
  getAlertDetail(@Param('alertId') alertId: string) {
    return this.providerService.getAlertDetail(alertId)
  }

  @Patch('alerts/:alertId/acknowledge')
  acknowledgeAlert(@Param('alertId') alertId: string) {
    return this.providerService.acknowledgeAlert(alertId)
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
}
