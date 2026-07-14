import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { RolesGuard } from '../auth/guards/roles.guard.js'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { UserRole } from '../generated/prisma/enums.js'
import { CoordinatorService } from './coordinator.service.js'

type AuthedReq = Request & { user: { id: string; roles: UserRole[] } }

/**
 * Coordinator front-desk surface (phase/28+). Role-gated to COORDINATOR (their
 * own practice) + SUPER_ADMIN. Returns identity/onboarding + care-team only —
 * no clinical data. Care-team writes go through the assignment endpoints.
 */
@Controller('admin/coordinator')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.COORDINATOR, UserRole.SUPER_ADMIN)
export class CoordinatorController {
  constructor(private readonly service: CoordinatorService) {}

  @Get('patients')
  patients(@Req() req: AuthedReq) {
    return this.service.listPatients(req.user.id)
  }

  @Get('clinicians')
  clinicians(@Req() req: AuthedReq) {
    return this.service.listClinicians(req.user.id)
  }
}
