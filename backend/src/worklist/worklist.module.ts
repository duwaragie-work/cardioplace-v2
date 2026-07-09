import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module.js'
import { AdminWorklistController } from './admin-worklist.controller.js'
import { WorklistService } from './worklist.service.js'

/**
 * L3 — reviewer worklist + security-incident lifecycle (HIPAA §164.312(b) +
 * §164.308(a)(6)). Pure reads over N7's AuditException rows plus triage /
 * incident writes; only needs the Prisma store.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AdminWorklistController],
  providers: [WorklistService],
})
export class WorklistModule {}
