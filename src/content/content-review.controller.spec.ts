import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { RolesGuard } from '../auth/guards/roles.guard.js'
import { ContentReviewController } from './content-review.controller.js'
import { ContentReviewService } from './content-review.service.js'
import { SubmitReviewDto } from './dto/submit-review.dto.js'
import { ReviewOutcome, ReviewType } from '../generated/prisma/enums.js'

const mockContentReviewService = {
  submitReview: jest.fn(),
  getReviewsForContent: jest.fn(),
}

describe('ContentReviewController', () => {
  let controller: ContentReviewController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContentReviewController],
      providers: [
        { provide: ContentReviewService, useValue: mockContentReviewService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get<ContentReviewController>(ContentReviewController)
    jest.clearAllMocks()
  })

  const authReq = { user: { id: 'rev-1' } }

  describe('submitReview', () => {
    it('delegates to contentReviewService.submitReview with reviewer id', () => {
      const dto: SubmitReviewDto = {
        reviewType: ReviewType.EDITORIAL,
        outcome: ReviewOutcome.APPROVED,
        notes: 'LGTM',
      }
      mockContentReviewService.submitReview.mockReturnValue({ status: 'PUBLISHED' })

      controller.submitReview('c-1', dto, authReq)

      expect(mockContentReviewService.submitReview).toHaveBeenCalledWith('c-1', dto, 'rev-1')
    })
  })

  describe('getReviews', () => {
    it('delegates to contentReviewService.getReviewsForContent', () => {
      mockContentReviewService.getReviewsForContent.mockReturnValue([])

      controller.getReviews('c-1')

      expect(mockContentReviewService.getReviewsForContent).toHaveBeenCalledWith('c-1')
    })
  })
})
