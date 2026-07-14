import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { UserRole } from '../generated/prisma/enums.js'
import {
  AssignIncidentDto,
  EscalateDto,
  IncidentNoteDto,
  ListExceptionsQuery,
  ListIncidentsQuery,
  MarkBenignDto,
  ResolveIncidentDto,
} from './dto/worklist.dto.js'
import { WorklistService, type WorklistActor } from './worklist.service.js'

type AuthedReq = Request & {
  user: { id: string; email: string | null; roles: UserRole[] }
}

/**
 * L3 reviewer worklist — mounted at `/api/v2/admin/worklist/*`, gated to
 * SUPER_ADMIN + HEALPLACE_OPS via the global RolesGuard (same org-wide
 * reviewers as the L2 audit console). Reads N7's AuditException rows and
 * records the triage decisions + security-incident lifecycle back.
 */
@Controller('v2/admin/worklist')
@Roles(UserRole.SUPER_ADMIN, UserRole.HEALPLACE_OPS)
export class AdminWorklistController {
  constructor(private readonly worklist: WorklistService) {}

  private actorFrom(req: AuthedReq): WorklistActor {
    return { id: req.user.id }
  }

  // ── Audit-exception worklist ──────────────────────────────────────────
  @Get('exceptions')
  listExceptions(@Query() query: ListExceptionsQuery) {
    return this.worklist.listExceptions(query)
  }

  @Get('exceptions/:id')
  getException(@Param('id') id: string) {
    return this.worklist.getException(id)
  }

  @Post('exceptions/:id/acknowledge')
  acknowledge(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.worklist.acknowledgeException(this.actorFrom(req), id)
  }

  @Post('exceptions/:id/benign')
  markBenign(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: MarkBenignDto,
  ) {
    return this.worklist.markBenign(this.actorFrom(req), id, dto)
  }

  @Post('exceptions/:id/escalate')
  escalate(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: EscalateDto,
  ) {
    return this.worklist.escalateException(this.actorFrom(req), id, dto)
  }

  // ── Security-incident lifecycle ───────────────────────────────────────
  @Get('incidents')
  listIncidents(@Query() query: ListIncidentsQuery) {
    return this.worklist.listIncidents(query)
  }

  @Get('incidents/:id')
  getIncident(@Param('id') id: string) {
    return this.worklist.getIncident(id)
  }

  @Post('incidents/:id/assign')
  assign(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: AssignIncidentDto,
  ) {
    return this.worklist.assignIncident(this.actorFrom(req), id, dto)
  }

  @Post('incidents/:id/note')
  addNote(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: IncidentNoteDto,
  ) {
    return this.worklist.addIncidentNote(this.actorFrom(req), id, dto)
  }

  @Post('incidents/:id/resolve')
  resolve(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: ResolveIncidentDto,
  ) {
    return this.worklist.resolveIncident(this.actorFrom(req), id, dto)
  }
}
