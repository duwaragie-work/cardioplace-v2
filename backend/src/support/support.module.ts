import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { EmailModule } from '../email/email.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { AdminSupportController } from './admin-support.controller.js'
import { SupportAutoCloseService } from './support-auto-close.service.js'
import { SupportController } from './support.controller.js'
import { SupportService } from './support.service.js'
import { TicketNumberService } from './ticket-number.service.js'

/**
 * Support System Phase 1 (HIPAA sprint). Imports AuthModule so the ops action
 * wrappers can call the existing admin reset methods; EmailModule for ops/user
 * mail; PrismaModule for the ticket store.
 */
@Module({
  imports: [PrismaModule, EmailModule, AuthModule],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService, TicketNumberService, SupportAutoCloseService],
})
export class SupportModule {}
