import { Module } from '@nestjs/common'
import { DailyJournalController } from './daily_journal.controller.js'
import { DailyJournalService } from './daily_journal.service.js'
import { AlertEngineService } from './services/alert-engine.service.js'
import { EscalationService } from './services/escalation.service.js'
import { JournalNotificationService } from './services/notification.service.js'
import { ProfileResolverService } from './services/profile-resolver.service.js'
import { SessionAveragerService } from './services/session-averager.service.js'

@Module({
  controllers: [DailyJournalController],
  providers: [
    DailyJournalService,
    AlertEngineService,
    EscalationService,
    JournalNotificationService,
    ProfileResolverService,
    SessionAveragerService,
  ],
  exports: [DailyJournalService, ProfileResolverService, AlertEngineService],
})
export class DailyJournalModule {}
