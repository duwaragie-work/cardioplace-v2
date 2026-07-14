import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module.js'
import { AccessLogReadService } from './access-log-read.service.js'
import { AdminAccessLogController } from './admin-access-log.controller.js'
import { AdminAuthLogController } from './admin-auth-log.controller.js'

/**
 * AccessLog module (Humaira N8 / 164.312-T7, HIPAA §164.312(b) audit controls).
 * The WRITE side is the access-log Prisma extension wired in PrismaService;
 * this module adds the READ side (sprint L2) — RBAC-gated, paginated
 * audit-review endpoints over AccessLog + AuthLog for the ops console.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AdminAccessLogController, AdminAuthLogController],
  providers: [AccessLogReadService],
})
export class AccessLogModule {}
