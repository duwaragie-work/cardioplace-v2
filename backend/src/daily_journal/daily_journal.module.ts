import { Module } from '@nestjs/common'
import { DailyJournalController } from './daily_journal.controller.js'
import { DailyJournalService } from './daily_journal.service.js'
import { BaselineService } from './services/baseline.service.js'
import { DeviationService } from './services/deviation.service.js'
import { EscalationService } from './services/escalation.service.js'
import { JournalNotificationService } from './services/notification.service.js'

@Module({
  controllers: [DailyJournalController],
  providers: [
    DailyJournalService,
    BaselineService,
    DeviationService,
    EscalationService,
    JournalNotificationService,
  ],
  exports: [DailyJournalService],
})
export class DailyJournalModule {}
