import { jest } from '@jest/globals'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import {
  ContentRevisionStatus,
  ContentStatus,
  ReviewOutcome,
  ReviewType,
} from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ContentReviewService } from './content-review.service.js'
import { ContentService } from './content.service.js'
import { SubmitReviewDto } from './dto/submit-review.dto.js'

type ReviewResult = { status: ContentStatus; revisionStatus: ContentRevisionStatus | null }

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const EDITORIAL_APPROVE: SubmitReviewDto = {
  reviewType: ReviewType.EDITORIAL,
  outcome: ReviewOutcome.APPROVED,
  notes: 'Looks good',
}

const CLINICAL_APPROVE: SubmitReviewDto = {
  reviewType: ReviewType.CLINICAL,
  outcome: ReviewOutcome.APPROVED,
  notes: 'Medically accurate',
}

const EDITORIAL_REJECT: SubmitReviewDto = {
  reviewType: ReviewType.EDITORIAL,
  outcome: ReviewOutcome.REJECTED,
  notes: 'Needs more clinical references',
}

function makeInitialContent(
  status: ContentStatus,
  reviews: object[] = [],
  versionNo = 2,
) {
  return {
    id: 'c-1',
    status,
    publishedVersionNo: null, // initial lifecycle — never published
    revisionStatus: null,
    reviews,
    versions: [{ versionNo }],
  }
}

function makePublishedContent(
  revisionStatus: ContentRevisionStatus | null = null,
  reviews: object[] = [],
  versionNo = 3,
) {
  return {
    id: 'c-1',
    status: ContentStatus.PUBLISHED,
    publishedVersionNo: 2, // already published
    revisionStatus,
    reviews,
    versions: [{ versionNo }],
  }
}

describe('ContentReviewService', () => {
  let service: ContentReviewService
  let contentService: jest.Mocked<ContentService>

  const mockPrisma = {
    content: {
      findUnique: jest.fn<() => Promise<unknown>>(),
    },
    contentReview: {
      create: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
    },
  }

  const mockContentService = {
    // Initial lifecycle
    moveToPartiallyApproved: jest.fn<() => Promise<unknown>>(),
    publishAfterDualApproval: jest.fn<() => Promise<unknown>>(),
    revertToDraftAfterRejection: jest.fn<() => Promise<unknown>>(),
    // Revision lifecycle
    moveRevisionToPartiallyApproved: jest.fn<() => Promise<unknown>>(),
    publishRevisionAfterDualApproval: jest.fn<() => Promise<unknown>>(),
    revertRevisionToDraft: jest.fn<() => Promise<unknown>>(),
    // Shared
    appendAuditLog: jest.fn<() => Promise<unknown>>(),
    assertExists: jest.fn<() => Promise<unknown>>(),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentReviewService,
        { provide: PrismaService, useValue: mockPrisma as unknown as PrismaService },
        { provide: ContentService, useValue: mockContentService },
      ],
    }).compile()

    service = module.get<ContentReviewService>(ContentReviewService)
    contentService = module.get(ContentService)
    jest.clearAllMocks()

    // Default safe resolution for side-effect mocks
    jest.mocked(mockPrisma.contentReview.create).mockResolvedValue(null)
    jest.mocked(mockContentService.appendAuditLog).mockResolvedValue(null)
    jest.mocked(mockContentService.publishAfterDualApproval).mockResolvedValue(null)
    jest.mocked(mockContentService.moveToPartiallyApproved).mockResolvedValue(null)
    jest.mocked(mockContentService.revertToDraftAfterRejection).mockResolvedValue(null)
    jest.mocked(mockContentService.publishRevisionAfterDualApproval).mockResolvedValue(null)
    jest.mocked(mockContentService.moveRevisionToPartiallyApproved).mockResolvedValue(null)
    jest.mocked(mockContentService.revertRevisionToDraft).mockResolvedValue(null)
  })

  // ─── Guard checks ─────────────────────────────────────────────────────────────

  describe('guard checks', () => {
    it('throws NotFoundException when content does not exist', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(null)

      await expect(service.submitReview('c-1', EDITORIAL_APPROVE, 'rev-1')).rejects.toThrow(NotFoundException)
    })

    it('throws BadRequestException when content is in a non-reviewable state (DRAFT, no revision)', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(makeInitialContent(ContentStatus.DRAFT))

      await expect(service.submitReview('c-1', EDITORIAL_APPROVE, 'rev-1')).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when PUBLISHED content has no active revision in review', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(makePublishedContent(null))

      await expect(service.submitReview('c-1', EDITORIAL_APPROVE, 'rev-1')).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when a review of the same type already exists for this version', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(
        makeInitialContent(ContentStatus.IN_REVIEW, [
          { reviewType: ReviewType.EDITORIAL, versionNo: 2, outcome: ReviewOutcome.APPROVED },
        ]),
      )

      await expect(service.submitReview('c-1', EDITORIAL_APPROVE, 'rev-1')).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when rejection has no notes', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(makeInitialContent(ContentStatus.IN_REVIEW))

      await expect(
        service.submitReview('c-1', { ...EDITORIAL_REJECT, notes: '   ' }, 'rev-1'),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ─── Initial lifecycle review ─────────────────────────────────────────────────

  describe('initial lifecycle review (status != PUBLISHED)', () => {
    it('reverts to DRAFT on rejection', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(makeInitialContent(ContentStatus.IN_REVIEW))

      const result = await service.submitReview('c-1', EDITORIAL_REJECT, 'rev-1')

      expect(result.status).toBe(ContentStatus.DRAFT)
      expect(contentService.revertToDraftAfterRejection).toHaveBeenCalledWith('c-1', 'rev-1', ContentStatus.IN_REVIEW)
      expect(contentService.revertRevisionToDraft).not.toHaveBeenCalled()
    })

    it('moves to PARTIALLY_APPROVED on first approval', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(makeInitialContent(ContentStatus.IN_REVIEW))
      jest.mocked(mockPrisma.contentReview.findMany).mockResolvedValue([
        { reviewType: ReviewType.EDITORIAL, outcome: ReviewOutcome.APPROVED },
      ])

      const result = await service.submitReview('c-1', EDITORIAL_APPROVE, 'rev-1')

      expect(result.status).toBe(ContentStatus.PARTIALLY_APPROVED)
      expect(contentService.moveToPartiallyApproved).toHaveBeenCalledWith('c-1', 'rev-1')
    })

    it('auto-publishes when both approvals are in', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(makeInitialContent(ContentStatus.PARTIALLY_APPROVED))
      jest.mocked(mockPrisma.contentReview.findMany).mockResolvedValue([
        { reviewType: ReviewType.EDITORIAL, outcome: ReviewOutcome.APPROVED },
        { reviewType: ReviewType.CLINICAL, outcome: ReviewOutcome.APPROVED },
      ])

      const result = await service.submitReview('c-1', CLINICAL_APPROVE, 'rev-1')

      expect(result.status).toBe(ContentStatus.PUBLISHED)
      expect(contentService.publishAfterDualApproval).toHaveBeenCalledWith('c-1', 'rev-1')
      expect(contentService.publishRevisionAfterDualApproval).not.toHaveBeenCalled()
    })

    it('treats APPROVED_WITH_MINOR_REVISIONS as an approval', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(makeInitialContent(ContentStatus.IN_REVIEW))
      jest.mocked(mockPrisma.contentReview.findMany).mockResolvedValue([
        { reviewType: ReviewType.EDITORIAL, outcome: ReviewOutcome.APPROVED_WITH_MINOR_REVISIONS },
      ])

      const result = await service.submitReview('c-1', { ...EDITORIAL_APPROVE, outcome: ReviewOutcome.APPROVED_WITH_MINOR_REVISIONS }, 'rev-1')

      expect(result.status).toBe(ContentStatus.PARTIALLY_APPROVED)
    })

    it('does not call moveToPartiallyApproved when second approval triggers publish', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(makeInitialContent(ContentStatus.PARTIALLY_APPROVED))
      jest.mocked(mockPrisma.contentReview.findMany).mockResolvedValue([
        { reviewType: ReviewType.EDITORIAL, outcome: ReviewOutcome.APPROVED },
        { reviewType: ReviewType.CLINICAL, outcome: ReviewOutcome.APPROVED },
      ])

      await service.submitReview('c-1', CLINICAL_APPROVE, 'rev-1')

      expect(contentService.moveToPartiallyApproved).not.toHaveBeenCalled()
    })
  })

  // ─── Background revision review ──────────────────────────────────────────────

  describe('background revision review (status === PUBLISHED + revisionStatus in review)', () => {
    it('reverts revision to DRAFT on rejection — live content is unaffected', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(
        makePublishedContent(ContentRevisionStatus.IN_REVIEW),
      )

      const result = await service.submitReview('c-1', EDITORIAL_REJECT, 'rev-1') as unknown as ReviewResult

      expect(result.status).toBe(ContentStatus.PUBLISHED)
      expect(result.revisionStatus).toBe(ContentRevisionStatus.DRAFT)
      expect(contentService.revertRevisionToDraft).toHaveBeenCalledWith('c-1', 'rev-1', ContentRevisionStatus.IN_REVIEW)
      expect(contentService.revertToDraftAfterRejection).not.toHaveBeenCalled()
    })

    it('moves revision to PARTIALLY_APPROVED on first approval', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(
        makePublishedContent(ContentRevisionStatus.IN_REVIEW),
      )
      jest.mocked(mockPrisma.contentReview.findMany).mockResolvedValue([
        { reviewType: ReviewType.EDITORIAL, outcome: ReviewOutcome.APPROVED },
      ])

      const result = await service.submitReview('c-1', EDITORIAL_APPROVE, 'rev-1') as unknown as ReviewResult

      expect(result.status).toBe(ContentStatus.PUBLISHED) // live version unaffected
      expect(result.revisionStatus).toBe(ContentRevisionStatus.PARTIALLY_APPROVED)
      expect(contentService.moveRevisionToPartiallyApproved).toHaveBeenCalledWith('c-1', 'rev-1')
      expect(contentService.moveToPartiallyApproved).not.toHaveBeenCalled()
    })

    it('publishes revision when both approvals are in — replaces live version', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(
        makePublishedContent(ContentRevisionStatus.PARTIALLY_APPROVED),
      )
      jest.mocked(mockPrisma.contentReview.findMany).mockResolvedValue([
        { reviewType: ReviewType.EDITORIAL, outcome: ReviewOutcome.APPROVED },
        { reviewType: ReviewType.CLINICAL, outcome: ReviewOutcome.APPROVED },
      ])

      const result = await service.submitReview('c-1', CLINICAL_APPROVE, 'rev-1') as unknown as ReviewResult

      expect(result.status).toBe(ContentStatus.PUBLISHED)
      expect(result.revisionStatus).toBeNull()
      expect(contentService.publishRevisionAfterDualApproval).toHaveBeenCalledWith('c-1', 'rev-1')
      expect(contentService.publishAfterDualApproval).not.toHaveBeenCalled()
    })

    it('accepts PARTIALLY_APPROVED revisionStatus as a valid reviewable state', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(
        makePublishedContent(ContentRevisionStatus.PARTIALLY_APPROVED),
      )
      jest.mocked(mockPrisma.contentReview.findMany).mockResolvedValue([
        { reviewType: ReviewType.EDITORIAL, outcome: ReviewOutcome.APPROVED },
      ])

      const result = await service.submitReview('c-1', EDITORIAL_APPROVE, 'rev-1') as unknown as ReviewResult

      // Only one approval — does NOT try to move to partially_approved again
      expect(result.status).toBe(ContentStatus.PUBLISHED)
      expect(contentService.moveRevisionToPartiallyApproved).not.toHaveBeenCalled()
    })
  })

  // ─── getReviewsForContent ─────────────────────────────────────────────────────

  describe('getReviewsForContent', () => {
    it('returns all reviews for a content item', async () => {
      const reviews = [{ id: 'r-1', reviewType: ReviewType.EDITORIAL }]
      jest.mocked(mockContentService.assertExists).mockResolvedValue({ id: 'c-1' })
      jest.mocked(mockPrisma.contentReview.findMany).mockResolvedValue(reviews)

      const result = await service.getReviewsForContent('c-1')

      expect(result).toEqual(reviews)
      expect(mockContentService.assertExists).toHaveBeenCalledWith('c-1')
    })

    it('propagates NotFoundException from assertExists', async () => {
      jest.mocked(mockContentService.assertExists).mockRejectedValue(new NotFoundException())

      await expect(service.getReviewsForContent('missing')).rejects.toThrow(NotFoundException)
    })
  })
})
