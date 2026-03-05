import { Module } from '@nestjs/common';
import { DailyJournalService } from './daily_journal.service.js';
import { DailyJournalController } from './daily_journal.controller.js';

@Module({
  controllers: [DailyJournalController],
  providers: [DailyJournalService],
})
export class DailyJournalModule {}
