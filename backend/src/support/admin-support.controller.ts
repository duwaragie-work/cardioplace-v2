import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import type { Request } from 'express'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { UserRole } from '../generated/prisma/enums.js'
import { ListTicketsQuery } from './dto/list-tickets.query.js'
import {
  ActionDto,
  AssignDto,
  PriorityDto,
  ReplyDto,
  ResolveDto,
  VerifyIdentityDto,
} from './dto/support-request.dto.js'
import { extractIp } from './http.util.js'
import {
  SupportService,
  type SupportActor,
  type SupportContext,
} from './support.service.js'

type AuthedReq = Request & {
  user: { id: string; email: string | null; roles: UserRole[] }
}

/**
 * Ops-facing support triage. Mounted at `/api/v2/admin/support/*`, gated to
 * HEALPLACE_OPS + SUPER_ADMIN via the global RolesGuard. The three `actions/*`
 * routes wrap the existing admin reset endpoints and are blocked in the service
 * until the ticket is identity-verified.
 */
@Controller('v2/admin/support')
@Roles(UserRole.HEALPLACE_OPS, UserRole.SUPER_ADMIN)
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  private actorFrom(req: AuthedReq): SupportActor {
    return { id: req.user.id, email: req.user.email, roles: req.user.roles }
  }

  private ctxFrom(req: Request): SupportContext {
    return { ipAddress: extractIp(req), userAgent: req.headers['user-agent'] }
  }

  @Get('tickets')
  list(@Query() query: ListTicketsQuery) {
    return this.support.listTickets(query)
  }

  /** First-response SLA attainment by priority. Derived at call time from the
   *  reply history — nothing about SLA is stored on the ticket.
   *  Declared before `tickets/:id` so 'sla' can't be captured as an id. */
  @Get('sla')
  slaReport() {
    return this.support.getSlaReport()
  }

  @Get('tickets/:id')
  get(@Param('id') id: string) {
    return this.support.getTicket(id)
  }

  @Post('tickets/:id/reply')
  reply(@Req() req: AuthedReq, @Param('id') id: string, @Body() dto: ReplyDto) {
    return this.support.reply(this.actorFrom(req), id, dto)
  }

  @Post('tickets/:id/verify-identity')
  verifyIdentity(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: VerifyIdentityDto,
  ) {
    return this.support.verifyIdentity(this.actorFrom(req), id, dto)
  }

  @Post('tickets/:id/resolve')
  resolve(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: ResolveDto,
  ) {
    return this.support.resolve(this.actorFrom(req), id, dto)
  }

  /** S4 — pick up / hand off a ticket (assign-to-me when body is empty). */
  @Post('tickets/:id/assign')
  assign(@Req() req: AuthedReq, @Param('id') id: string, @Body() dto: AssignDto) {
    return this.support.assign(this.actorFrom(req), id, dto)
  }

  /** S5 — ops re-triages a ticket's priority. */
  @Post('tickets/:id/priority')
  priority(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: PriorityDto,
  ) {
    return this.support.changePriority(this.actorFrom(req), id, dto)
  }

  @Post('tickets/:id/actions/mfa-reset')
  mfaReset(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: ActionDto,
  ) {
    return this.support.actionMfaReset(
      this.actorFrom(req),
      id,
      dto,
      this.ctxFrom(req),
    )
  }

  @Post('tickets/:id/actions/recovery-codes-regen')
  recoveryCodesRegen(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: ActionDto,
  ) {
    return this.support.actionRecoveryCodesRegen(
      this.actorFrom(req),
      id,
      dto,
      this.ctxFrom(req),
    )
  }

  @Post('tickets/:id/actions/webauthn-reset')
  webauthnReset(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: ActionDto,
  ) {
    return this.support.actionWebauthnReset(
      this.actorFrom(req),
      id,
      dto,
      this.ctxFrom(req),
    )
  }
}
