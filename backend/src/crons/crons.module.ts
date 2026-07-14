import { Module } from '@nestjs/common'
import { DailyJournalModule } from '../daily_journal/daily_journal.module.js'
import { AuditExceptionReportService } from './audit-exception-report.service.js'
import { AuditExceptionWriter } from './audit-exception-report/audit-exception-writer.js'
import { DailyReminderService } from './daily-reminder.service.js'
import { ReminderDispatcherService } from './daily-reminder/reminder-dispatcher.service.js'
import { MedicationHoldEscalationService } from './medication-hold-escalation.service.js'
import { MonthlyReaskService } from './monthly-reask.service.js'
import { SessionFinalizeService } from './session-finalize.service.js'

@Module({
  imports: [DailyJournalModule],
  providers: [
    MedicationHoldEscalationService,
    MonthlyReaskService,
    SessionFinalizeService,
    // N7 (2026-07-11) — audit exception-report cron + writer.
    AuditExceptionReportService,
    AuditExceptionWriter,
    // N2 (2026-07-13) — daily reminder cron + dispatcher. Replaces the
    // deleted GapAlertService (N3).
    DailyReminderService,
    ReminderDispatcherService,
  ],
  exports: [
    MedicationHoldEscalationService,
    MonthlyReaskService,
    SessionFinalizeService,
    AuditExceptionReportService,
    AuditExceptionWriter,
    DailyReminderService,
    ReminderDispatcherService,
  ],
})
export class CronsModule {}
