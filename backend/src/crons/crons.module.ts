import { Module } from '@nestjs/common'
import { DailyJournalModule } from '../daily_journal/daily_journal.module.js'
import { AuditExceptionReportService } from './audit-exception-report.service.js'
import { AuditExceptionWriter } from './audit-exception-report/audit-exception-writer.js'
import { GapAlertService } from './gap-alert.service.js'
import { MedicationHoldEscalationService } from './medication-hold-escalation.service.js'
import { MonthlyReaskService } from './monthly-reask.service.js'
import { SessionFinalizeService } from './session-finalize.service.js'

@Module({
  imports: [DailyJournalModule],
  providers: [
    GapAlertService,
    MedicationHoldEscalationService,
    MonthlyReaskService,
    SessionFinalizeService,
    // N7 (2026-07-11) — audit exception-report cron + writer.
    AuditExceptionReportService,
    AuditExceptionWriter,
  ],
  exports: [
    GapAlertService,
    MedicationHoldEscalationService,
    MonthlyReaskService,
    SessionFinalizeService,
    AuditExceptionReportService,
    AuditExceptionWriter,
  ],
})
export class CronsModule {}
