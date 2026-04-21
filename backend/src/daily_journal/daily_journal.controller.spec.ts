import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service.js';
import { DailyJournalController } from './daily_journal.controller.js';
import { DailyJournalService } from './daily_journal.service.js';

const mockPrisma = {
  journalEntry: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  deviationAlert: { findMany: jest.fn() },
}
const mockEventEmitter = { emit: jest.fn() }

describe('DailyJournalController', () => {
  let controller: DailyJournalController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DailyJournalController],
      providers: [
        DailyJournalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    controller = module.get<DailyJournalController>(DailyJournalController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
