import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { RolesGuard } from '../auth/guards/roles.guard.js'
import { UserRole } from '../generated/prisma/enums.js'
import { BulkInviteUserDto } from './dto/bulk-invite-user.dto.js'
import { DeactivateDto } from './dto/deactivate.dto.js'
import { PermanentCloseDto } from './dto/permanent-close.dto.js'
import { ReactivateDto } from './dto/reactivate.dto.js'
import { InviteUserDto } from './dto/invite-user.dto.js'
import { ListUsersQuery } from './dto/list-users.query.js'
import type { Actor } from './users.service.js'
import { UsersService } from './users.service.js'

type AuthedReq = Request & {
  user: { id: string; email: string | null; roles: UserRole[] }
}

/**
 * Admin-only user management endpoints. Mounted at `/admin/users`
 * (admin app proxies through `/api/admin/users` per the existing
 * convention). The controller-level @Roles decorator gates role
 * membership; UsersService.assertCanInvite / assertCanDeactivate
 * enforce the per-practice + per-target-role cells of the matrix.
 *
 * Activation flow lives on AuthController (/v2/auth/invite/:token)
 * — that endpoint is @Public() because the user doesn't have a
 * session yet.
 */
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.COORDINATOR, UserRole.HEALPLACE_OPS, UserRole.SUPER_ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  private actorFrom(req: AuthedReq): Actor {
    return {
      id: req.user.id,
      email: req.user.email,
      roles: req.user.roles,
    }
  }

  private buildContext(req: AuthedReq) {
    return {
      ipAddress: this.extractIp(req),
      userAgent: req.headers['user-agent'],
    }
  }

  private extractIp(req: Request): string | undefined {
    const forwarded = req.headers['x-forwarded-for']
    if (forwarded) {
      const first = Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded.split(',')[0]
      return first?.trim()
    }
    return req.ip
  }

  // ─── Invite (single + bulk) ───────────────────────────────────────────────

  @Post('invite')
  invite(@Req() req: AuthedReq, @Body() dto: InviteUserDto) {
    return this.usersService.invite(
      this.actorFrom(req),
      dto,
      this.buildContext(req),
    )
  }

  @Post('invite/bulk')
  bulkInvite(@Req() req: AuthedReq, @Body() dto: BulkInviteUserDto) {
    return this.usersService.bulkInvite(
      this.actorFrom(req),
      dto,
      this.buildContext(req),
    )
  }

  // ─── List ─────────────────────────────────────────────────────────────────

  @Get()
  list(@Req() req: AuthedReq, @Query() query: ListUsersQuery) {
    return this.usersService.listUsers(this.actorFrom(req), query)
  }

  // ─── Deactivate / Reactivate ──────────────────────────────────────────────

  @Post(':id/deactivate')
  deactivate(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: DeactivateDto,
  ) {
    return this.usersService.deactivate(
      this.actorFrom(req),
      id,
      dto,
      this.buildContext(req),
    )
  }

  @Post(':id/reactivate')
  reactivate(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: ReactivateDto,
  ) {
    return this.usersService.reactivate(
      this.actorFrom(req),
      id,
      dto,
      this.buildContext(req),
    )
  }

  @Post(':id/permanent-close')
  permanentClose(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: PermanentCloseDto,
  ) {
    return this.usersService.permanentClose(
      this.actorFrom(req),
      id,
      dto,
      this.buildContext(req),
    )
  }

  @Delete(':id/roles/:role')
  removeRole(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Param('role') role: string,
  ) {
    if (!(role in UserRole)) {
      throw new BadRequestException(`Unknown role: ${role}`)
    }
    return this.usersService.removeRole(
      this.actorFrom(req),
      id,
      role as UserRole,
      this.buildContext(req),
    )
  }

  // ─── Invite admin (resend / revoke) ───────────────────────────────────────

  @Post('invite/:id/resend')
  resendInvite(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.usersService.resendInvite(
      this.actorFrom(req),
      id,
      this.buildContext(req),
    )
  }

  @Post('invite/:id/revoke')
  revokeInvite(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.usersService.revokeInvite(
      this.actorFrom(req),
      id,
      this.buildContext(req),
    )
  }
}
