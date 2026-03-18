import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { PrismaModule } from '../prisma/prisma.module.js'
import { ContentController } from './content.controller.js'
import { ContentRatingService } from './content-rating.service.js'
import { ContentReviewController } from './content-review.controller.js'
import { ContentReviewService } from './content-review.service.js'
import { ContentSchedulerService } from './content-scheduler.service.js'
import { ContentService } from './content.service.js'

@Module({
  imports: [
    PrismaModule,
    ScheduleModule.forRoot(), // Registers the NestJS cron scheduler
  ],
  controllers: [ContentController, ContentReviewController],
  providers: [
    ContentService,
    ContentReviewService,
    ContentRatingService,
    ContentSchedulerService,
  ],
  exports: [ContentService], // Exported in case other modules need to query content metadata
})
export class ContentModule {}
