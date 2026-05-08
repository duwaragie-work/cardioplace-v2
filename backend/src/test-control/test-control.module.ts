import { Module } from '@nestjs/common'
import { TestControlController } from './test-control.controller.js'
import { TestControlService } from './test-control.service.js'
import { CronsModule } from '../crons/crons.module.js'
import { DailyJournalModule } from '../daily_journal/daily_journal.module.js'

/**
 * Dev-only test-control module. Wires up endpoints used by the Playwright
 * suite (and ops tooling) to drive cron + escalation deterministically.
 *
 * Mounted in app.module.ts only when ENABLE_TEST_CONTROL=true. NEVER ship
 * with the flag on in production — these endpoints bypass admin guards and
 * mutate state by design.
 */
@Module({
  imports: [CronsModule, DailyJournalModule],
  controllers: [TestControlController],
  providers: [TestControlService],
})
export class TestControlModule {}
