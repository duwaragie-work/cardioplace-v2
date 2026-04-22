import { Module } from '@nestjs/common'
import { DailyJournalController } from './daily_journal.controller.js'
import { DailyJournalService } from './daily_journal.service.js'
import { DeviationService } from './services/deviation.service.js'
import { EscalationService } from './services/escalation.service.js'
import { JournalNotificationService } from './services/notification.service.js'
import { ProfileResolverService } from './services/profile-resolver.service.js'

@Module({
  controllers: [DailyJournalController],
  providers: [
    DailyJournalService,
    DeviationService,
    EscalationService,
    JournalNotificationService,
    ProfileResolverService,
  ],
  exports: [DailyJournalService, ProfileResolverService],
})
export class DailyJournalModule {}
