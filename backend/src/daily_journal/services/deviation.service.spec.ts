import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PrismaService } from '../../prisma/prisma.service.js'
import { DeviationService } from './deviation.service.js'

// TODO(phase/5): rewrite this spec once AlertEngineService replaces the
// v1 baseline-relative deviation logic. The v1 tests exercised baseline
// events + symptom+medication streak logic that no longer exists in v2.
describe('DeviationService', () => {
  let service: DeviationService

  beforeEach(async () => {
    const prisma = {
      deviationAlert: {
        upsert: jest.fn(),
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
        updateMany: (jest.fn() as jest.Mock<any>).mockResolvedValue({ count: 0 }),
      },
    }
    const eventEmitter = { emit: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviationService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile()

    service = module.get<DeviationService>(DeviationService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })
})
