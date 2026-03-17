import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { ContentService } from './content.service.js'
import { RateContentDto } from './dto/rate-content.dto.js'

@Injectable()
export class ContentRatingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contentService: ContentService,
  ) {}

  async upsertRating(contentId: string, userId: string, dto: RateContentDto) {
    await this.contentService.assertExists(contentId)

    // Upsert: one rating per user per content
    await this.prisma.contentRating.upsert({
      where: { contentId_userId: { contentId, userId } },
      create: { contentId, userId, ratingValue: dto.ratingValue },
      update: { ratingValue: dto.ratingValue },
    })

    // Recompute and cache aggregate on Content row
    await this.recalculateAggregate(contentId)

    return { message: 'Rating saved successfully' }
  }

  private async recalculateAggregate(contentId: string) {
    const result = await this.prisma.contentRating.aggregate({
      where: { contentId },
      _avg: { ratingValue: true },
      _count: { ratingValue: true },
    })

    await this.prisma.content.update({
      where: { id: contentId },
      data: {
        ratingAvg: result._avg.ratingValue ?? 0,
        ratingsCount: result._count.ratingValue,
      },
    })
  }
}
