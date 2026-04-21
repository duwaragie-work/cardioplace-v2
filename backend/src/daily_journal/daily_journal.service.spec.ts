import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service.js';
import { DailyJournalService } from './daily_journal.service.js';

const mockPrisma = {
  journalEntry: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  deviationAlert: { findMany: jest.fn() },
}
const mockEventEmitter = { emit: jest.fn() }

describe('DailyJournalService', () => {
  let service: DailyJournalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailyJournalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<DailyJournalService>(DailyJournalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
