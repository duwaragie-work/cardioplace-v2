import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { ContentStatus } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ContentSchedulerService } from './content-scheduler.service.js'

describe('ContentSchedulerService', () => {
  let service: ContentSchedulerService

  const mockPrisma = {
    content: {
      findMany: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<unknown>>(),
    },
    contentAuditLog: {
      createMany: jest.fn<() => Promise<unknown>>(),
    },
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentSchedulerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile()

    service = module.get<ContentSchedulerService>(ContentSchedulerService)
    jest.clearAllMocks()
  })

  describe('flagStaleContent', () => {
    it('does not update anything when no stale content is found', async () => {
      jest.mocked(mockPrisma.content.findMany).mockResolvedValue([])

      await service.flagStaleContent()

      expect(mockPrisma.content.updateMany).not.toHaveBeenCalled()
      expect(mockPrisma.contentAuditLog.createMany).not.toHaveBeenCalled()
    })

    it('bulk-updates needsReview for all stale items', async () => {
      jest
        .mocked(mockPrisma.content.findMany)
        .mockResolvedValue([{ id: 'c-1' }, { id: 'c-2' }])
      jest.mocked(mockPrisma.content.updateMany).mockResolvedValue({ count: 2 })
      jest.mocked(mockPrisma.contentAuditLog.createMany).mockResolvedValue({ count: 2 })

      await service.flagStaleContent()

      expect(mockPrisma.content.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['c-1', 'c-2'] } },
        data: { needsReview: true },
      })
    })

    it('creates a flag_stale audit log entry for each stale item', async () => {
      jest
        .mocked(mockPrisma.content.findMany)
        .mockResolvedValue([{ id: 'c-1' }, { id: 'c-2' }])
      jest.mocked(mockPrisma.content.updateMany).mockResolvedValue({ count: 2 })
      jest.mocked(mockPrisma.contentAuditLog.createMany).mockResolvedValue({ count: 2 })

      await service.flagStaleContent()

      expect(mockPrisma.contentAuditLog.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ contentId: 'c-1', event: 'flag_stale', actorId: null }),
          expect.objectContaining({ contentId: 'c-2', event: 'flag_stale', actorId: null }),
        ]),
      })
    })

    it('queries only PUBLISHED, non-flagged content beyond the cutoff', async () => {
      jest.mocked(mockPrisma.content.findMany).mockResolvedValue([])

      await service.flagStaleContent()

      expect(mockPrisma.content.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: ContentStatus.PUBLISHED,
            needsReview: false,
            OR: expect.arrayContaining([
              expect.objectContaining({ lastReviewed: { lt: expect.any(Date) } }),
              { lastReviewed: null },
            ]),
          }),
        }),
      )
    })

    it('uses a cutoff date approximately one year in the past', async () => {
      jest.mocked(mockPrisma.content.findMany).mockResolvedValue([])

      await service.flagStaleContent()

      expect(mockPrisma.content.findMany).toHaveBeenCalledTimes(1)
      const [[callArg]] = jest.mocked(mockPrisma.content.findMany).mock.calls as unknown as [
        [{ where: { OR: [{ lastReviewed: { lt: Date } }] } }],
      ]
      const cutoff = callArg.where.OR[0].lastReviewed.lt

      const expectedCutoff = new Date()
      expectedCutoff.setFullYear(expectedCutoff.getFullYear() - 1)

      // Cutoff should be within 5 seconds of 1 year ago
      expect(Math.abs(cutoff.getTime() - expectedCutoff.getTime())).toBeLessThan(5000)
    })
  })
})
