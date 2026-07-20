import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import type { Request } from 'express'
import { Public } from '../auth/decorators/public.decorator.js'
import { UserRole } from '../generated/prisma/enums.js'
import { ContactDto, LockedOutDto, ReplyDto } from './dto/support-request.dto.js'
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
 * Public + signed-in support intake. Mounted at `/api/v2/support/*`.
 * JwtAuthGuard is a global APP_GUARD, so `contact` requires a session (any
 * role) while `locked-out` opts out via @Public.
 */
@Controller('v2/support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  private actorFrom(req: AuthedReq): SupportActor {
    return { id: req.user.id, email: req.user.email, roles: req.user.roles }
  }

  private ctxFrom(req: Request): SupportContext {
    return { ipAddress: extractIp(req), userAgent: req.headers['user-agent'] }
  }

  /** Any signed-in user raising a ticket — lands identity-verified. */
  @Post('contact')
  contact(@Req() req: AuthedReq, @Body() dto: ContactDto) {
    return this.support.createContactTicket(
      this.actorFrom(req),
      dto,
      this.ctxFrom(req),
    )
  }

  /** The signed-in user's own support tickets + reply threads (Fix 9). */
  @Get('tickets/mine')
  myTickets(@Req() req: AuthedReq) {
    return this.support.listMyTickets(this.actorFrom(req))
  }

  /** Patient adds an in-thread reply to their own active ticket (→ ops).
   *  Scoped to the requester in the service (NotFound on a non-owned id). */
  @Post('tickets/:id/reply')
  reply(@Req() req: AuthedReq, @Param('id') id: string, @Body() dto: ReplyDto) {
    return this.support.replyAsUser(this.actorFrom(req), id, dto)
  }

  /** Patient reopens their own resolved/closed ticket within the reopen window. */
  @Post('tickets/:id/reopen')
  reopen(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.support.reopen(this.actorFrom(req), id)
  }

  /** Unauthenticated "I can't sign in" form — rate-limited 5/IP/hour in the
   *  service; lands identity-UNverified pending ops phone verification. */
  @Public()
  @Post('locked-out')
  lockedOut(@Req() req: Request, @Body() dto: LockedOutDto) {
    return this.support.createLockedOutTicket(dto, this.ctxFrom(req))
  }
}
