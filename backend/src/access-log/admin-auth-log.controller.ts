import { Controller, Get, Query } from '@nestjs/common'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { UserRole } from '../generated/prisma/enums.js'
import { AccessLogReadService } from './access-log-read.service.js'
import { ListAuthLogQuery } from './dto/list-auth-log.query.js'

/**
 * Read side of the AuthLog (auth-event audit trail, HIPAA §164.312(b), sprint
 * L2). Mounted at /api/v2/admin/audit/auth-log, org-wide roles only, enforced
 * by the global JwtAuthGuard + RolesGuard. Mirrors AdminSupportController.
 */
@Controller('v2/admin/audit/auth-log')
@Roles(UserRole.SUPER_ADMIN, UserRole.HEALPLACE_OPS)
export class AdminAuthLogController {
  constructor(private readonly service: AccessLogReadService) {}

  @Get()
  list(@Query() query: ListAuthLogQuery) {
    return this.service.listAuthLogs(query)
  }
}
