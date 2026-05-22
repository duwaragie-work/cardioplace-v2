import { Module } from '@nestjs/common'
import { DailyJournalModule } from '../daily_journal/daily_journal.module.js'
import { GapAlertService } from './gap-alert.service.js'
import { MonthlyReaskService } from './monthly-reask.service.js'
import { SessionFinalizeService } from './session-finalize.service.js'

@Module({
  imports: [DailyJournalModule],
  providers: [GapAlertService, MonthlyReaskService, SessionFinalizeService],
  exports: [GapAlertService, MonthlyReaskService, SessionFinalizeService],
})
export class CronsModule {}
