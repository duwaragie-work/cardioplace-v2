import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { EmailModule } from '../email/email.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { MonthlyReportCron } from './monthly-report.cron.js'
import { ReportsController } from './reports.controller.js'
import { ReportsService } from './reports.service.js'
import { AdherenceController } from './adherence.controller.js'
import { AdherenceService } from './adherence.service.js'
import { QuarterlyController } from './quarterly.controller.js'
import { QuarterlyService } from './quarterly.service.js'
import { SlaController } from './sla.controller.js'
import { SlaService } from './sla.service.js'

/**
 * Phase/24 — Monthly Practice Analytics Report.
 *
 * Endpoints + cron that compute and surface per-practice KPIs from the
 * existing DeviationAlert / EscalationEvent tables. No new business data
 * is created here — only a cache table (`MonthlyReportSnapshot`) for
 * historical immutability + fast reads.
 *
 * PrismaModule + EmailModule are already @Global, but we declare them
 * explicitly so the dependency graph is self-documenting. ConfigModule
 * for `ADMIN_BASE_URL` used in the email deep-link.
 */
@Module({
  imports: [PrismaModule, EmailModule, ConfigModule],
  controllers: [
    ReportsController,
    AdherenceController,
    QuarterlyController,
    SlaController,
  ],
  providers: [
    ReportsService,
    MonthlyReportCron,
    AdherenceService,
    QuarterlyService,
    SlaService,
  ],
  exports: [
    ReportsService,
    MonthlyReportCron,
    AdherenceService,
    QuarterlyService,
    SlaService,
  ],
})
export class ReportsModule {}
