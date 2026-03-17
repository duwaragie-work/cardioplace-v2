import { Test, TestingModule } from '@nestjs/testing';
import { DailyJournalService } from './daily_journal.service.js';

describe('DailyJournalService', () => {
  let service: DailyJournalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DailyJournalService],
    }).compile();

    service = module.get<DailyJournalService>(DailyJournalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
