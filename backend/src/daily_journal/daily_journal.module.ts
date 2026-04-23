import { Module } from '@nestjs/common'
import { DailyJournalController } from './daily_journal.controller.js'
import { DailyJournalService } from './daily_journal.service.js'
import { AlertResolutionController } from './controllers/alert-resolution.controller.js'
import { AlertEngineService } from './services/alert-engine.service.js'
import { AlertResolutionService } from './services/alert-resolution.service.js'
import { EscalationService } from './services/escalation.service.js'
import { OutputGeneratorService } from './services/output-generator.service.js'
import { ProfileResolverService } from './services/profile-resolver.service.js'
import { SessionAveragerService } from './services/session-averager.service.js'

// Phase/7 — retired JournalNotificationService. The v1 service listened on
// `ESCALATION_CREATED` which is no longer emitted; EscalationService now owns
// notification dispatch inline. Patient-facing BP Level 1 notifications will
// get their own event in phase/11+ when Dev 1 builds the admin dashboard.

@Module({
  controllers: [DailyJournalController, AlertResolutionController],
  providers: [
    DailyJournalService,
    AlertEngineService,
    AlertResolutionService,
    EscalationService,
    OutputGeneratorService,
    ProfileResolverService,
    SessionAveragerService,
  ],
  exports: [
    DailyJournalService,
    ProfileResolverService,
    AlertEngineService,
    AlertResolutionService,
    EscalationService,
  ],
})
export class DailyJournalModule {}
