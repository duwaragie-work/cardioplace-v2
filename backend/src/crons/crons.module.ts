import { Module } from '@nestjs/common'
import { DailyJournalModule } from '../daily_journal/daily_journal.module.js'
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
  ],
  exports: [
    GapAlertService,
    MedicationHoldEscalationService,
    MonthlyReaskService,
    SessionFinalizeService,
  ],
})
export class CronsModule {}
