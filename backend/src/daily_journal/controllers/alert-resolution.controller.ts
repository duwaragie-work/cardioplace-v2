import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js'
import { RolesGuard } from '../../auth/guards/roles.guard.js'
import { Roles } from '../../auth/decorators/roles.decorator.js'
import { UserRole } from '../../generated/prisma/enums.js'
import { ResolveAlertDto } from '../dto/resolve-alert.dto.js'
import { AlertResolutionService } from '../services/alert-resolution.service.js'

/**
 * Phase/7 — admin-only endpoints for acknowledging, resolving, and auditing
 * DeviationAlert rows. Mounted under /admin/alerts so the phase/11 admin UI
 * can consume them without naming collisions with the patient-facing
 * /daily-journal routes.
 *
 * Authorization: SUPER_ADMIN, MEDICAL_DIRECTOR, PROVIDER, HEALPLACE_OPS.
 * PATIENT role is excluded — resolution is always clinician-driven.
 */
@Controller('admin/alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.MEDICAL_DIRECTOR,
  UserRole.PROVIDER,
  UserRole.HEALPLACE_OPS,
)
export class AlertResolutionController {
  constructor(private readonly service: AlertResolutionService) {}

  @Post(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  acknowledge(@Req() req: Request, @Param('id') id: string) {
    const { id: adminId } = req.user as { id: string }
    return this.service.acknowledge(id, adminId)
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ResolveAlertDto,
  ) {
    const { id: adminId } = req.user as { id: string }
    return this.service.resolve(id, adminId, dto)
  }

  @Get(':id/audit')
  audit(@Param('id') id: string) {
    return this.service.buildAuditPayload(id)
  }
}
