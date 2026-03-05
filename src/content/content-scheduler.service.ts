import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ContentStatus } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
@Injectable()
export class ContentSchedulerService {
  private readonly logger = new Logger(ContentSchedulerService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Twice a month at 2AM — flag content that has not been reviewed in over 365 days.
   * Status stays PUBLISHED; only needsReview is set to true.
   * Stale content is excluded from chatbot KB queries via needsReview = false filter.
   */
  @Cron('0 2 1,15 * *') // 2AM on the 1st and 15th of every month (~bi-weekly)
  async flagStaleContent() {
    const cutoffDate = new Date()
    cutoffDate.setFullYear(cutoffDate.getFullYear() - 1) // 365 days ago

    this.logger.log(`Running stale content check. Cutoff date: ${cutoffDate.toISOString()}`)

    const staleContent = await this.prisma.content.findMany({
      where: {
        status: ContentStatus.PUBLISHED,
        needsReview: false,
        OR: [
          { lastReviewed: { lt: cutoffDate } },
          { lastReviewed: null }, // Never reviewed (shouldn't happen after publish, but guard anyway)
        ],
      },
      select: { id: true },
    })

    if (staleContent.length === 0) {
      this.logger.log('No stale content found.')
      return
    }

    this.logger.log(`Flagging ${staleContent.length} stale content item(s)`)

    const ids = staleContent.map((c) => c.id)

    // Bulk update needsReview flag
    await this.prisma.content.updateMany({
      where: { id: { in: ids } },
      data: { needsReview: true },
    })

    // Append audit log entry for each flagged item
    await this.prisma.contentAuditLog.createMany({
      data: ids.map((contentId) => ({
        contentId,
        event: 'flag_stale',
        actorId: null, // scheduler-triggered
        metadata: { reason: 'lastReviewed > 365 days ago', cutoffDate },
      })),
    })

    this.logger.log(`Stale content flagging complete. ${ids.length} item(s) flagged.`)
  }
}
