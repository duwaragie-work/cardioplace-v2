import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  ContentRevisionStatus,
  ContentStatus,
  ReviewOutcome,
  ReviewType,
} from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ContentService } from './content.service.js'
import { SubmitReviewDto } from './dto/submit-review.dto.js'

@Injectable()
export class ContentReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contentService: ContentService,
  ) {}

  /**
   * Submit a review outcome. Handles two distinct paths:
   *  - INITIAL lifecycle: content.status IN [IN_REVIEW, PARTIALLY_APPROVED] and publishedVersionNo IS NULL
   *  - REVISION lifecycle: content.status === PUBLISHED and revisionStatus IN [IN_REVIEW, PARTIALLY_APPROVED]
   */
  async submitReview(contentId: string, dto: SubmitReviewDto, reviewerId: string) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      include: {
        reviews: { orderBy: { reviewedAt: 'desc' } },
        versions: { orderBy: { versionNo: 'desc' }, take: 1 },
      },
    })

    if (!content) throw new NotFoundException('Content not found')

    // ── Determine which review path we're on ──────────────────────────────────
    const isRevisionReview =
      content.status === ContentStatus.PUBLISHED &&
      (content.revisionStatus === ContentRevisionStatus.IN_REVIEW ||
        content.revisionStatus === ContentRevisionStatus.PARTIALLY_APPROVED)

    const isInitialReview =
      content.publishedVersionNo === null &&
      (content.status === ContentStatus.IN_REVIEW ||
        content.status === ContentStatus.PARTIALLY_APPROVED)

    if (!isRevisionReview && !isInitialReview) {
      throw new BadRequestException(
        'Content is not in a reviewable state. ' +
          'For initial review: status must be IN_REVIEW or PARTIALLY_APPROVED (before first publish). ' +
          'For revision review: status must be PUBLISHED with revisionStatus IN_REVIEW or PARTIALLY_APPROVED.',
      )
    }

    // ── Get the version being reviewed ────────────────────────────────────────
    // The "current version" for review purposes is always the latest version
    const currentVersionNo = content.versions[0]?.versionNo ?? 1

    // ── Prevent duplicate review of same type in this round ──────────────────
    const existingReview = content.reviews.find(
      (r) => r.reviewType === dto.reviewType && r.versionNo === currentVersionNo,
    )
    if (existingReview) {
      throw new BadRequestException(
        `An ${dto.reviewType} review has already been submitted for version ${currentVersionNo}`,
      )
    }

    // ── Validate notes on rejection ───────────────────────────────────────────
    if (dto.outcome === ReviewOutcome.REJECTED && !dto.notes?.trim()) {
      throw new BadRequestException('Notes are required when rejecting content')
    }

    // ── Persist the review record ─────────────────────────────────────────────
    await this.prisma.contentReview.create({
      data: {
        contentId,
        versionNo: currentVersionNo,
        reviewType: dto.reviewType,
        outcome: dto.outcome,
        notes: dto.notes ?? null,
        reviewedById: reviewerId,
      },
    })

    // ── Handle rejection ──────────────────────────────────────────────────────
    if (dto.outcome === ReviewOutcome.REJECTED) {
      await this.contentService.appendAuditLog(
        contentId,
        `${dto.reviewType.toLowerCase()}_rejected`,
        reviewerId,
        { outcome: dto.outcome, notes: dto.notes, versionNo: currentVersionNo },
      )

      if (isRevisionReview) {
        // Revision rejected → revisionStatus back to DRAFT; live version unaffected
        await this.contentService.revertRevisionToDraft(
          contentId,
          reviewerId,
          content.revisionStatus as ContentRevisionStatus,
        )
        return {
          status: ContentStatus.PUBLISHED,
          revisionStatus: ContentRevisionStatus.DRAFT,
          message: 'Revision rejected. Background draft is available for editing again.',
        }
      } else {
        // Initial lifecycle rejected → status back to DRAFT
        await this.contentService.revertToDraftAfterRejection(
          contentId,
          reviewerId,
          content.status,
        )
        return { status: ContentStatus.DRAFT, message: 'Content rejected and reverted to DRAFT' }
      }
    }

    // ── Handle approval ───────────────────────────────────────────────────────
    const approvedOutcomes: ReviewOutcome[] = [
      ReviewOutcome.APPROVED,
      ReviewOutcome.APPROVED_WITH_MINOR_REVISIONS,
    ]
    const isApproved = approvedOutcomes.includes(dto.outcome)

    if (isApproved) {
      await this.contentService.appendAuditLog(
        contentId,
        `${dto.reviewType.toLowerCase()}_approved`,
        reviewerId,
        { outcome: dto.outcome, versionNo: currentVersionNo, path: isRevisionReview ? 'revision' : 'initial' },
      )

      // Refresh all reviews for this version to check dual-approval gate
      const allReviews = await this.prisma.contentReview.findMany({
        where: { contentId, versionNo: currentVersionNo },
      })

      const editorialApproved = allReviews.some(
        (r) => r.reviewType === ReviewType.EDITORIAL && approvedOutcomes.includes(r.outcome),
      )
      const clinicalApproved = allReviews.some(
        (r) => r.reviewType === ReviewType.CLINICAL && approvedOutcomes.includes(r.outcome),
      )

      if (editorialApproved && clinicalApproved) {
        // ── Both approvals present → publish ──────────────────────────────────
        if (isRevisionReview) {
          await this.contentService.publishRevisionAfterDualApproval(contentId, reviewerId)
          return {
            status: ContentStatus.PUBLISHED,
            revisionStatus: null,
            message: 'Revision approved and now live. Previous version superseded.',
          }
        } else {
          await this.contentService.publishAfterDualApproval(contentId, reviewerId)
          await this.contentService.appendAuditLog(contentId, 'approved', reviewerId, {
            fromStatus: content.status,
            toStatus: ContentStatus.PUBLISHED,
            versionNo: currentVersionNo,
          })
          return { status: ContentStatus.PUBLISHED, message: 'Content approved and published' }
        }
      }

      // ── Only one approval so far ──────────────────────────────────────────
      const otherType = dto.reviewType === ReviewType.EDITORIAL ? 'CLINICAL' : 'EDITORIAL'

      if (isRevisionReview) {
        if (content.revisionStatus === ContentRevisionStatus.IN_REVIEW) {
          await this.contentService.moveRevisionToPartiallyApproved(contentId, reviewerId)
        }
        return {
          status: ContentStatus.PUBLISHED,
          revisionStatus: ContentRevisionStatus.PARTIALLY_APPROVED,
          message: `${dto.reviewType} review approved. Waiting for ${otherType} review.`,
        }
      } else {
        if (content.status === ContentStatus.IN_REVIEW) {
          await this.contentService.moveToPartiallyApproved(contentId, reviewerId)
        }
        return {
          status: ContentStatus.PARTIALLY_APPROVED,
          message: `${dto.reviewType} review approved. Waiting for ${otherType} review.`,
        }
      }
    }

    return { status: content.status, message: 'Review recorded' }
  }

  async getReviewsForContent(contentId: string) {
    await this.contentService.assertExists(contentId)
    return this.prisma.contentReview.findMany({
      where: { contentId },
      orderBy: { reviewedAt: 'desc' },
      include: { reviewedBy: { select: { id: true, name: true, email: true } } },
    })
  }
}
