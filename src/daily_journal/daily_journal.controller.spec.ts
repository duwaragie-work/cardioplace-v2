import { Test, TestingModule } from '@nestjs/testing';
import { DailyJournalController } from './daily_journal.controller.js';
import { DailyJournalService } from './daily_journal.service.js';

describe('DailyJournalController', () => {
  let controller: DailyJournalController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DailyJournalController],
      providers: [DailyJournalService],
    }).compile();

    controller = module.get<DailyJournalController>(DailyJournalController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
