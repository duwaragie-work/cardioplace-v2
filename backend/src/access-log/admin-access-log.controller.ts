import { Controller, Get, Query } from '@nestjs/common'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { UserRole } from '../generated/prisma/enums.js'
import { AccessLogReadService } from './access-log-read.service.js'
import { ListAccessLogQuery } from './dto/list-access-log.query.js'

/**
 * Read side of the PHI AccessLog (HIPAA §164.312(b) audit controls, sprint L2).
 * Mounted at /api/v2/admin/audit/access-log, org-wide roles only, enforced by
 * the global JwtAuthGuard + RolesGuard (registered in AuthModule). Mirrors
 * AdminSupportController's class-level @Roles + pagination.
 */
@Controller('v2/admin/audit/access-log')
@Roles(UserRole.SUPER_ADMIN, UserRole.HEALPLACE_OPS)
export class AdminAccessLogController {
  constructor(private readonly service: AccessLogReadService) {}

  @Get()
  list(@Query() query: ListAccessLogQuery) {
    return this.service.listAccessLogs(query)
  }
}
