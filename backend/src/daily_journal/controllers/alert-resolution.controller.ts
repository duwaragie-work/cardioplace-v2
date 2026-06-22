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
import { ActiveContext } from '../../auth/decorators/active-context.decorator.js'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js'
import { RolesGuard } from '../../auth/guards/roles.guard.js'
import { Roles } from '../../auth/decorators/roles.decorator.js'
import { UserRole } from '../../generated/prisma/enums.js'
import { ResolveAlertDto } from '../dto/resolve-alert.dto.js'
import { AlertResolutionService } from '../services/alert-resolution.service.js'

/**
 * Phase/7 — admin endpoints for acknowledging, resolving, and auditing
 * DeviationAlert rows. Mounted under /admin/alerts so the phase/11 admin UI
 * can consume them without naming collisions with the patient-facing
 * /daily-journal routes.
 *
 * Authorization (May 2026 access-scope decision — see docs/ACCESS_SCOPE.md):
 *   • READ (GET :id/audit) — all four admin roles. HEALPLACE_OPS receives the
 *     T+24h / T+48h escalation notification and needs read context for
 *     operational follow-up (phone the patient, page the assigned provider).
 *   • WRITE (acknowledge / resolve) — SUPER_ADMIN, MEDICAL_DIRECTOR, PROVIDER
 *     only. Closing an alert is a clinical disposition. HEALPLACE_OPS is
 *     excluded — they reassign care team or escalate by phone instead.
 *   • PATIENT role is excluded from everything here.
 * Method-level @Roles() overrides the controller-level decorator.
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
  @Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR, UserRole.PROVIDER)
  acknowledge(
    @Req() req: Request,
    @Param('id') id: string,
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    const { id: actorId, roles } = req.user as {
      id: string
      roles: UserRole[]
    }
    return this.service.acknowledge(id, { id: actorId, roles }, ctx)
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR, UserRole.PROVIDER)
  resolve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ResolveAlertDto,
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    const { id: actorId, roles } = req.user as {
      id: string
      roles: UserRole[]
    }
    return this.service.resolve(id, { id: actorId, roles }, dto, ctx)
  }

  @Get(':id/audit')
  audit(@Param('id') id: string) {
    return this.service.buildAuditPayload(id)
  }
}
