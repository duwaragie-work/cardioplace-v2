import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { RolesGuard } from '../auth/guards/roles.guard.js'
import { UserRole } from '../generated/prisma/enums.js'
import { ContentReviewService } from './content-review.service.js'
import { SubmitReviewDto } from './dto/submit-review.dto.js'

@Controller('v2/content')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CONTENT_APPROVER, UserRole.SUPER_ADMIN)
export class ContentReviewController {
  constructor(private readonly contentReviewService: ContentReviewService) {}

  /** POST /content/:id/review — submit editorial or clinical review outcome */
  @Post(':id/review')
  submitReview(
    @Param('id') id: string,
    @Body() dto: SubmitReviewDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.contentReviewService.submitReview(id, dto, req.user.id)
  }

  /** GET /content/:id/reviews — list all reviews for a content item */
  @Get(':id/reviews')
  getReviews(@Param('id') id: string) {
    return this.contentReviewService.getReviewsForContent(id)
  }
}
