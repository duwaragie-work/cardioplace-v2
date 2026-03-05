import { jest } from '@jest/globals'
import { NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { PrismaService } from '../prisma/prisma.service.js'
import { ContentRatingService } from './content-rating.service.js'
import { ContentService } from './content.service.js'
import { RateContentDto } from './dto/rate-content.dto.js'

describe('ContentRatingService', () => {
  let service: ContentRatingService

  const mockPrisma = {
    contentRating: {
      upsert: jest.fn<() => Promise<unknown>>(),
      aggregate: jest.fn<() => Promise<unknown>>(),
    },
    content: {
      update: jest.fn<() => Promise<unknown>>(),
    },
  }

  const mockContentService = {
    assertExists: jest.fn<() => Promise<unknown>>(),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentRatingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ContentService, useValue: mockContentService },
      ],
    }).compile()

    service = module.get<ContentRatingService>(ContentRatingService)
    jest.clearAllMocks()
  })

  describe('upsertRating', () => {
    const contentId = 'c-1'
    const userId = 'u-1'
    const dto: RateContentDto = { ratingValue: 4 }

    it('upserts a rating and recalculates the aggregate', async () => {
      jest.mocked(mockContentService.assertExists).mockResolvedValue({ id: contentId })
      jest.mocked(mockPrisma.contentRating.upsert).mockResolvedValue(null)
      jest.mocked(mockPrisma.contentRating.aggregate).mockResolvedValue({
        _avg: { ratingValue: 4.2 },
        _count: { ratingValue: 10 },
      })

      const result = await service.upsertRating(contentId, userId, dto)

      expect(result).toEqual({ message: 'Rating saved successfully' })
      expect(mockPrisma.contentRating.upsert).toHaveBeenCalledWith({
        where: { contentId_userId: { contentId, userId } },
        create: { contentId, userId, ratingValue: 4 },
        update: { ratingValue: 4 },
      })
    })

    it('updates the cached aggregate on the Content row', async () => {
      jest.mocked(mockContentService.assertExists).mockResolvedValue({ id: contentId })
      jest.mocked(mockPrisma.contentRating.upsert).mockResolvedValue(null)
      jest.mocked(mockPrisma.contentRating.aggregate).mockResolvedValue({
        _avg: { ratingValue: 3.5 },
        _count: { ratingValue: 6 },
      })

      await service.upsertRating(contentId, userId, dto)

      expect(mockPrisma.content.update).toHaveBeenCalledWith({
        where: { id: contentId },
        data: { ratingAvg: 3.5, ratingsCount: 6 },
      })
    })

    it('defaults ratingAvg to 0 when there are no ratings yet', async () => {
      jest.mocked(mockContentService.assertExists).mockResolvedValue({ id: contentId })
      jest.mocked(mockPrisma.contentRating.upsert).mockResolvedValue(null)
      jest.mocked(mockPrisma.contentRating.aggregate).mockResolvedValue({
        _avg: { ratingValue: null },
        _count: { ratingValue: 0 },
      })

      await service.upsertRating(contentId, userId, dto)

      expect(mockPrisma.content.update).toHaveBeenCalledWith({
        where: { id: contentId },
        data: { ratingAvg: 0, ratingsCount: 0 },
      })
    })

    it('propagates NotFoundException when content does not exist', async () => {
      jest
        .mocked(mockContentService.assertExists)
        .mockRejectedValue(new NotFoundException('Content not found'))

      await expect(service.upsertRating('missing', userId, dto)).rejects.toThrow(NotFoundException)
      expect(mockPrisma.contentRating.upsert).not.toHaveBeenCalled()
    })
  })
})
