import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '../generated/prisma/client.js'
import {
  ContentRevisionStatus,
  ContentStatus,
} from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { CreateContentDto } from './dto/create-content.dto.js'
import { ListContentQueryDto } from './dto/list-content-query.dto.js'
import { UpdateContentDto } from './dto/update-content.dto.js'

// ─── Helper ──────────────────────────────────────────────────────────────────
/** Fields that determine whether a version snapshot should be created. */
const CONTENT_FIELDS = [
  'title',
  'body',
  'summary',
  'author',
  'contentType',
  'tags',
  'mediaUrl',
] as const

type ContentFieldKey = (typeof CONTENT_FIELDS)[number]

function pickContentFields(obj: Record<string, unknown>) {
  return Object.fromEntries(
    CONTENT_FIELDS.filter((k) => k in obj).map((k) => [k, obj[k]]),
  )
}

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Create ──────────────────────────────────────────────────────────────────

  async create(dto: CreateContentDto, submittedById: string) {
    const content = await this.prisma.content.create({
      data: {
        title: dto.title,
        contentType: dto.contentType,
        body: dto.body,
        summary: dto.summary,
        author: dto.author ?? null,
        tags: dto.tags ?? [],
        mediaUrl: dto.mediaUrl ?? null,
        submittedById,
        status: ContentStatus.DRAFT,
      },
    })

    // The first version is always created immediately on content creation (Bug 2 fix)
    await this.prisma.contentVersion.create({
      data: {
        contentId: content.id,
        versionNo: 1,
        snapshotJson: pickContentFields(content as Record<string, unknown>) as Prisma.InputJsonObject,
        changeReason: 'initial draft',
        isDraft: true,
        isPublished: false,
        createdById: submittedById,
      },
    })

    await this.appendAuditLog(content.id, 'create', submittedById, {
      toStatus: ContentStatus.DRAFT,
    })

    return content
  }

  // ─── Read (public) ───────────────────────────────────────────────────────────

  async listPublished(query: ListContentQueryDto) {
    const { type, tags, page = 1, limit = 20 } = query
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = {
      status: ContentStatus.PUBLISHED,
      needsReview: false,
      deletedAt: null,
    }
    if (type) where.contentType = type
    if (tags && tags.length > 0) {
      where.tags = { hasSome: tags }
    }

    const [items, total] = await Promise.all([
      this.prisma.content.findMany({
        where,
        skip,
        take: limit,
        orderBy: { publishedAt: 'desc' },
        include: { submittedBy: { select: { id: true, name: true } } },
      }),
      this.prisma.content.count({ where }),
    ])

    return { items, total, page, limit }
  }

  async findOnePublished(id: string, userId?: string, deviceId?: string) {
    const content = await this.prisma.content.findFirst({
      where: { id, status: ContentStatus.PUBLISHED, needsReview: false, deletedAt: null },
      include: { submittedBy: { select: { id: true, name: true } } },
    })
    if (!content) throw new NotFoundException('Content not found')

    // Append view record (fire-and-forget)
    this.prisma.contentView
      .create({ data: { contentId: id, userId, deviceId } })
      .catch(() => null)

    return content
  }

  // ─── Read (admin) ────────────────────────────────────────────────────────────

  async listAdmin(query: ListContentQueryDto) {
    const { type, tags, status, page = 1, limit = 20 } = query
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = { deletedAt: null }
    if (type) where.contentType = type
    if (status) where.status = status
    if (tags && tags.length > 0) where.tags = { hasSome: tags }

    const [items, total] = await Promise.all([
      this.prisma.content.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: { submittedBy: { select: { id: true, name: true } } },
      }),
      this.prisma.content.count({ where }),
    ])

    return { items, total, page, limit }
  }

  async findOneAdmin(id: string) {
    const content = await this.prisma.content.findFirst({
      where: { id, deletedAt: null },
      include: {
        submittedBy: { select: { id: true, name: true, email: true } },
        reviews: { include: { reviewedBy: { select: { id: true, name: true } } } },
      },
    })
    if (!content) throw new NotFoundException('Content not found')
    return content
  }

  // ─── Update (initial DRAFT only) ─────────────────────────────────────────────
  //
  // This applies only to the first lifecycle of a content item (before first publish).
  // For editing a published piece, use startRevision() + updateRevision().

  async update(id: string, dto: UpdateContentDto, actorId: string) {
    const content = await this.prisma.content.findUnique({ where: { id } })
    if (!content) throw new NotFoundException('Content not found')

    if (content.status !== ContentStatus.DRAFT || content.publishedVersionNo !== null) {
      throw new BadRequestException(
        'Use PATCH /revision to edit a published article. ' +
          'Initial DRAFT editing is only allowed before first publish.',
      )
    }

    // Check if any content field actually changed (Bug 1 prevention)
    const incoming = dto as unknown as Record<string, unknown>
    const contentAsRecord = content as unknown as Record<string, unknown>
    const hasFieldChange = CONTENT_FIELDS.some(
      (k) => k in incoming && incoming[k] !== undefined && incoming[k] !== contentAsRecord[k],
    )

    const updated = await this.prisma.content.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.body !== undefined && { body: dto.body }),
        ...(dto.summary !== undefined && { summary: dto.summary }),
        ...(dto.author !== undefined && { author: dto.author }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.mediaUrl !== undefined && { mediaUrl: dto.mediaUrl }),
      },
    })

    if (hasFieldChange) {
      // Unmark the previous draft version
      await this.prisma.contentVersion.updateMany({
        where: { contentId: id, isDraft: true },
        data: { isDraft: false },
      })

      const versionNo = await this.nextVersionNo(id)
      await this.prisma.contentVersion.create({
        data: {
          contentId: id,
          versionNo,
          snapshotJson: pickContentFields(updated as Record<string, unknown>) as Prisma.InputJsonObject,
          changeReason: 'draft edit',
          isDraft: true,
          isPublished: false,
          createdById: actorId,
        },
      })

      await this.appendAuditLog(id, 'save_draft', actorId, { versionNo })
    }

    return updated
  }

  // ─── Submit for Review (initial lifecycle) ───────────────────────────────────

  async submitForReview(id: string, actorId: string) {
    const content = await this.prisma.content.findUnique({ where: { id } })
    if (!content) throw new NotFoundException('Content not found')
    if (content.status !== ContentStatus.DRAFT || content.publishedVersionNo !== null) {
      throw new BadRequestException('Only unpublished DRAFT content can be submitted for review')
    }

    // NO version snapshot — state transition only (Bug 1 fix)
    const updated = await this.prisma.content.update({
      where: { id },
      data: { status: ContentStatus.IN_REVIEW },
    })

    await this.appendAuditLog(id, 'submit_review', actorId, {
      fromStatus: ContentStatus.DRAFT,
      toStatus: ContentStatus.IN_REVIEW,
    })

    return updated
  }

  // ─── Unpublish ───────────────────────────────────────────────────────────────

  async unpublish(id: string, actorId: string) {
    const content = await this.prisma.content.findUnique({ where: { id } })
    if (!content) throw new NotFoundException('Content not found')
    if (content.status !== ContentStatus.PUBLISHED) {
      throw new BadRequestException('Content must be PUBLISHED to unpublish')
    }

    await this.prisma.contentVersion.updateMany({
      where: { contentId: id, isPublished: true },
      data: { isPublished: false },
    })

    const updated = await this.prisma.content.update({
      where: { id },
      data: {
        status: ContentStatus.UNPUBLISHED,
        publishedVersionNo: null,
        revisionStatus: null,
      },
    })

    await this.appendAuditLog(id, 'unpublished', actorId, {
      fromStatus: ContentStatus.PUBLISHED,
      toStatus: ContentStatus.UNPUBLISHED,
    })

    return updated
  }

  // ─── Re-open Unpublished for Editing ─────────────────────────────────────────

  async reopenForEditing(id: string, actorId: string) {
    const content = await this.prisma.content.findUnique({ where: { id } })
    if (!content) throw new NotFoundException('Content not found')
    if (content.status !== ContentStatus.UNPUBLISHED) {
      throw new BadRequestException('Only UNPUBLISHED content can be re-opened')
    }

    // Create a new draft version from the last snapshot to allow editing again
    const lastVersion = await this.prisma.contentVersion.findFirst({
      where: { contentId: id },
      orderBy: { versionNo: 'desc' },
    })

    const versionNo = await this.nextVersionNo(id)
    await this.prisma.contentVersion.create({
      data: {
        contentId: id,
        versionNo,
        snapshotJson: (lastVersion?.snapshotJson ?? pickContentFields(content as Record<string, unknown>)) as Prisma.InputJsonObject,
        changeReason: 're-opened for editing',
        isDraft: true,
        isPublished: false,
        createdById: actorId,
      },
    })

    const updated = await this.prisma.content.update({
      where: { id },
      data: { status: ContentStatus.DRAFT },
    })

    await this.appendAuditLog(id, 'reopened_for_editing', actorId, {
      fromStatus: ContentStatus.UNPUBLISHED,
      toStatus: ContentStatus.DRAFT,
    })

    return updated
  }

  // ─── Soft Delete (SUPER_ADMIN only) ──────────────────────────────────────────

  async softDelete(id: string, actorId: string) {
    const content = await this.prisma.content.findFirst({ where: { id, deletedAt: null } })
    if (!content) throw new NotFoundException('Content not found')

    if (content.status === ContentStatus.PUBLISHED) {
      await this.prisma.contentVersion.updateMany({
        where: { contentId: id, isPublished: true },
        data: { isPublished: false },
      })
    }

    const updated = await this.prisma.content.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    await this.appendAuditLog(id, 'soft_deleted', actorId, {
      fromStatus: content.status,
      deletedAt: updated.deletedAt,
    })

    return { message: 'Content soft-deleted successfully', contentId: id }
  }

  // ─── Mark as Reviewed (clears stale flag) ────────────────────────────────────

  async markAsReviewed(id: string, actorId: string) {
    const content = await this.prisma.content.findFirst({
      where: { id, deletedAt: null },
    })
    if (!content) throw new NotFoundException('Content not found')
    if (!content.needsReview) {
      throw new BadRequestException('Content is not flagged for review')
    }

    const updated = await this.prisma.content.update({
      where: { id },
      data: { needsReview: false, lastReviewed: new Date() },
    })

    await this.appendAuditLog(id, 'marked_reviewed', actorId, {
      newLastReviewed: updated.lastReviewed,
    })

    return updated
  }

  // ─── Super Admin: Publish Any Version ────────────────────────────────────────

  async superAdminPublish(id: string, versionNo: number, overrideReason: string, actorId: string) {
    const content = await this.prisma.content.findUnique({ where: { id } })
    if (!content) throw new NotFoundException('Content not found')

    const version = await this.prisma.contentVersion.findUnique({
      where: { contentId_versionNo: { contentId: id, versionNo } },
    })
    if (!version) throw new NotFoundException(`Version ${versionNo} not found`)

    await this.prisma.contentVersion.updateMany({
      where: { contentId: id, isPublished: true },
      data: { isPublished: false },
    })

    await this.prisma.contentVersion.update({
      where: { contentId_versionNo: { contentId: id, versionNo } },
      data: { isPublished: true, isDraft: false },
    })

    // Update content fields from the version snapshot
    const snap = version.snapshotJson as Record<string, unknown>
    const updated = await this.prisma.content.update({
      where: { id },
      data: {
        ...(snap.title !== undefined && { title: snap.title as string }),
        ...(snap.body !== undefined && { body: snap.body as string }),
        ...(snap.summary !== undefined && { summary: snap.summary as string }),
        ...(snap.author !== undefined && { author: snap.author as string | null }),
        ...(snap.tags !== undefined && { tags: snap.tags as string[] }),
        ...(snap.mediaUrl !== undefined && { mediaUrl: snap.mediaUrl as string | null }),
        status: ContentStatus.PUBLISHED,
        publishedVersionNo: versionNo,
        publishedAt: new Date(),
        lastReviewed: new Date(),
        needsReview: false,
        revisionStatus: null,
      },
    })

    await this.appendAuditLog(id, 'super_admin_override', actorId, {
      fromStatus: content.status,
      toStatus: ContentStatus.PUBLISHED,
      versionNo,
      overrideReason,
    })

    return updated
  }

  // ─── Background Revision (Option B) ──────────────────────────────────────────

  /**
   * Starts a background revision of a published content item.
   * The currently-live version stays public while the new revision is drafted.
   */
  async startRevision(id: string, actorId: string) {
    const content = await this.prisma.content.findFirst({
      where: { id, deletedAt: null },
    })
    if (!content) throw new NotFoundException('Content not found')
    if (content.status !== ContentStatus.PUBLISHED) {
      throw new BadRequestException('Only PUBLISHED content can have a background revision started')
    }
    if (content.revisionStatus !== null) {
      throw new BadRequestException('A revision is already in progress for this content')
    }

    // Update content to DRAFT revision status
    // NOTE: We do NOT create a placeholder version here (user feedback optimization)
    const updated = await this.prisma.content.update({
      where: { id },
      data: { revisionStatus: ContentRevisionStatus.DRAFT },
    })

    await this.appendAuditLog(id, 'revision_started', actorId)

    return { ...updated }
  }

  /**
   * Edit the in-flight background revision draft.
   * Does NOT change the live published content fields — only the pending version snapshot.
   */
  async updateRevision(id: string, dto: UpdateContentDto, actorId: string) {
    const content = await this.prisma.content.findFirst({
      where: { id, deletedAt: null },
    })
    if (!content) throw new NotFoundException('Content not found')
    if (
      content.status !== ContentStatus.PUBLISHED ||
      content.revisionStatus !== ContentRevisionStatus.DRAFT
    ) {
      throw new BadRequestException('Content must be PUBLISHED with a revision in DRAFT state')
    }

    // Find the current draft revision version
    const currentDraft = await this.prisma.contentVersion.findFirst({
      where: { contentId: id, isDraft: true },
      orderBy: { versionNo: 'desc' },
    })

    let baseSnapshot: Record<string, unknown>
    let isFirstRevisionEdit = false

    if (!currentDraft) {
      // First edit of a new revision cycle: use the currently published version as base
      const liveVersion = content.publishedVersionNo
        ? await this.prisma.contentVersion.findUnique({
            where: { contentId_versionNo: { contentId: id, versionNo: content.publishedVersionNo } },
          })
        : null
      
      baseSnapshot = (liveVersion?.snapshotJson as Record<string, unknown>) ?? pickContentFields(content as Record<string, unknown>)
      isFirstRevisionEdit = true
    } else {
      baseSnapshot = currentDraft.snapshotJson as Record<string, unknown>
    }

    const incoming = dto as unknown as Record<string, unknown>
    const hasFieldChange = CONTENT_FIELDS.some(
      (k) => k in incoming && incoming[k] !== undefined && incoming[k] !== baseSnapshot[k],
    )

    if (!hasFieldChange) {
      return { 
        message: 'No content fields changed — no new version created', 
        versionNo: currentDraft?.versionNo ?? content.publishedVersionNo 
      }
    }

    // Build the merged snapshot
    const newSnapshot: Record<string, unknown> = { ...baseSnapshot }
    for (const k of CONTENT_FIELDS as unknown as ContentFieldKey[]) {
      if (incoming[k] !== undefined) newSnapshot[k] = incoming[k]
    }

    if (!isFirstRevisionEdit && currentDraft) {
      // Retire the current draft before creating a new one
      await this.prisma.contentVersion.update({
        where: { contentId_versionNo: { contentId: id, versionNo: currentDraft.versionNo } },
        data: { isDraft: false },
      })
    }

    const versionNo = await this.nextVersionNo(id)
    await this.prisma.contentVersion.create({
      data: {
        contentId: id,
        versionNo,
        snapshotJson: newSnapshot as Prisma.InputJsonObject,
        changeReason: 'revision draft edit',
        isDraft: true,
        isPublished: false,
        createdById: actorId,
      },
    })

    await this.appendAuditLog(id, 'revision_saved', actorId, { versionNo })

    return { message: 'Revision draft updated', versionNo }
  }

  /**
   * Submit the background revision for the dual-approval review cycle.
   */
  async submitRevisionForReview(id: string, actorId: string) {
    const content = await this.prisma.content.findFirst({
      where: { id, deletedAt: null },
    })
    if (!content) throw new NotFoundException('Content not found')
    if (
      content.status !== ContentStatus.PUBLISHED ||
      content.revisionStatus !== ContentRevisionStatus.DRAFT
    ) {
      throw new BadRequestException('Content must be PUBLISHED with a revision in DRAFT state')
    }

    // Guard: Ensure at least one actual change was made (a draft version exists)
    const draftExists = await this.prisma.contentVersion.findFirst({
      where: { contentId: id, isDraft: true },
    })
    if (!draftExists) {
      throw new BadRequestException('Cannot submit revision: No changes have been made yet')
    }

    const updated = await this.prisma.content.update({
      where: { id },
      data: { revisionStatus: ContentRevisionStatus.IN_REVIEW },
    })

    await this.appendAuditLog(id, 'revision_submitted', actorId, {
      fromRevisionStatus: ContentRevisionStatus.DRAFT,
      toRevisionStatus: ContentRevisionStatus.IN_REVIEW,
    })

    return updated
  }

  // ─── Versions ────────────────────────────────────────────────────────────────

  async listVersions(id: string) {
    await this.assertExists(id)
    return this.prisma.contentVersion.findMany({
      where: { contentId: id },
      orderBy: { versionNo: 'asc' },
      select: {
        versionNo: true,
        changeReason: true,
        isDraft: true,
        isPublished: true,
        createdById: true,
        createdAt: true,
      },
    })
  }

  async getVersion(id: string, versionNo: number) {
    const version = await this.prisma.contentVersion.findUnique({
      where: { contentId_versionNo: { contentId: id, versionNo } },
    })
    if (!version) throw new NotFoundException(`Version ${versionNo} not found`)
    return version
  }

  // ─── Audit Log ───────────────────────────────────────────────────────────────

  async getAuditLog(id: string) {
    await this.assertExists(id)
    return this.prisma.contentAuditLog.findMany({
      where: { contentId: id },
      orderBy: { createdAt: 'asc' },
    })
  }

  // ─── View Count ──────────────────────────────────────────────────────────────

  async getViewCount(id: string) {
    await this.assertExists(id)
    const count = await this.prisma.contentView.count({ where: { contentId: id } })
    return { contentId: id, viewCount: count }
  }

  // ─── Internal helpers (called by ContentReviewService) ───────────────────────

  /**
   * Initial-lifecycle: both EDITORIAL + CLINICAL approved.
   * Marks the latest isDraft version as isPublished=true. Does NOT create a new version.
   */
  async publishAfterDualApproval(id: string, actorId: string) {
    const content = await this.prisma.content.findUnique({ where: { id } })
    if (!content) throw new NotFoundException('Content not found')

    // Find the current draft version (the last edited snapshot)
    const draftVersion = await this.prisma.contentVersion.findFirst({
      where: { contentId: id, isDraft: true },
      orderBy: { versionNo: 'desc' },
    })
    if (!draftVersion) throw new NotFoundException('No draft version found to publish')

    // Unmark any previously-published version
    await this.prisma.contentVersion.updateMany({
      where: { contentId: id, isPublished: true },
      data: { isPublished: false },
    })

    // Promote the draft version to published
    await this.prisma.contentVersion.update({
      where: { contentId_versionNo: { contentId: id, versionNo: draftVersion.versionNo } },
      data: { isDraft: false, isPublished: true },
    })

    // Update Content fields from the snapshot and advance status
    const snap = draftVersion.snapshotJson as Record<string, unknown>
    const updated = await this.prisma.content.update({
      where: { id },
      data: {
        ...(snap.title !== undefined && { title: snap.title as string }),
        ...(snap.body !== undefined && { body: snap.body as string }),
        ...(snap.summary !== undefined && { summary: snap.summary as string }),
        ...(snap.author !== undefined && { author: snap.author as string | null }),
        ...(snap.tags !== undefined && { tags: snap.tags as string[] }),
        ...(snap.mediaUrl !== undefined && { mediaUrl: snap.mediaUrl as string | null }),
        status: ContentStatus.PUBLISHED,
        publishedVersionNo: draftVersion.versionNo,
        publishedAt: new Date(),
        lastReviewed: new Date(),
        needsReview: false,
      },
    })

    await this.appendAuditLog(id, 'published', actorId, {
      fromStatus: content.status,
      toStatus: ContentStatus.PUBLISHED,
      versionNo: draftVersion.versionNo,
    })

    return updated
  }

  /** Initial-lifecycle: rejected — revert to DRAFT. No new version created. */
  async revertToDraftAfterRejection(id: string, actorId: string, fromStatus: ContentStatus) {
    const content = await this.prisma.content.findUnique({ where: { id } })
    if (!content) throw new NotFoundException('Content not found')

    // The existing isDraft version remains; admin can continue editing it
    const updated = await this.prisma.content.update({
      where: { id },
      data: { status: ContentStatus.DRAFT },
    })

    await this.appendAuditLog(id, 'rejected', actorId, {
      fromStatus,
      toStatus: ContentStatus.DRAFT,
    })

    return updated
  }

  /** Initial-lifecycle: first approval in. */
  async moveToPartiallyApproved(id: string, actorId: string) {
    const updated = await this.prisma.content.update({
      where: { id },
      data: { status: ContentStatus.PARTIALLY_APPROVED },
    })

    await this.appendAuditLog(id, 'partially_approved', actorId, {
      fromStatus: ContentStatus.IN_REVIEW,
      toStatus: ContentStatus.PARTIALLY_APPROVED,
    })

    return updated
  }

  // ─── Revision-lifecycle internal helpers ─────────────────────────────────────

  /**
   * Background revision: both approvals in.
   * Promotes the revision draft version to live. Updates Content fields.
   */
  async publishRevisionAfterDualApproval(id: string, actorId: string) {
    const content = await this.prisma.content.findUnique({ where: { id } })
    if (!content) throw new NotFoundException('Content not found')

    const revisionDraft = await this.prisma.contentVersion.findFirst({
      where: { contentId: id, isDraft: true },
      orderBy: { versionNo: 'desc' },
    })
    if (!revisionDraft) throw new NotFoundException('No revision draft version found')

    // Retire old published version
    await this.prisma.contentVersion.updateMany({
      where: { contentId: id, isPublished: true },
      data: { isPublished: false },
    })

    // Promote revision to published
    await this.prisma.contentVersion.update({
      where: { contentId_versionNo: { contentId: id, versionNo: revisionDraft.versionNo } },
      data: { isDraft: false, isPublished: true },
    })

    // Apply new field values from the revision snapshot to the Content row
    const snap = revisionDraft.snapshotJson as Record<string, unknown>
    const updated = await this.prisma.content.update({
      where: { id },
      data: {
        ...(snap.title !== undefined && { title: snap.title as string }),
        ...(snap.body !== undefined && { body: snap.body as string }),
        ...(snap.summary !== undefined && { summary: snap.summary as string }),
        ...(snap.author !== undefined && { author: snap.author as string | null }),
        ...(snap.tags !== undefined && { tags: snap.tags as string[] }),
        ...(snap.mediaUrl !== undefined && { mediaUrl: snap.mediaUrl as string | null }),
        status: ContentStatus.PUBLISHED,
        publishedVersionNo: revisionDraft.versionNo,
        revisionStatus: null,
        publishedAt: new Date(),
        lastReviewed: new Date(),
        needsReview: false,
      },
    })

    await this.appendAuditLog(id, 'revision_published', actorId, {
      previousVersionNo: content.publishedVersionNo,
      newVersionNo: revisionDraft.versionNo,
    })

    return updated
  }

  /** Background revision: first approval in. */
  async moveRevisionToPartiallyApproved(id: string, actorId: string) {
    const updated = await this.prisma.content.update({
      where: { id },
      data: { revisionStatus: ContentRevisionStatus.PARTIALLY_APPROVED },
    })

    await this.appendAuditLog(id, 'revision_partially_approved', actorId, {
      fromRevisionStatus: ContentRevisionStatus.IN_REVIEW,
      toRevisionStatus: ContentRevisionStatus.PARTIALLY_APPROVED,
    })

    return updated
  }

  /** Background revision: rejected — revert revisionStatus to DRAFT so admin can keep editing. */
  async revertRevisionToDraft(id: string, actorId: string, fromRevisionStatus: ContentRevisionStatus) {
    const updated = await this.prisma.content.update({
      where: { id },
      data: { revisionStatus: ContentRevisionStatus.DRAFT },
    })

    await this.appendAuditLog(id, 'revision_rejected', actorId, {
      fromRevisionStatus,
      toRevisionStatus: ContentRevisionStatus.DRAFT,
    })

    return updated
  }

  // ─── Shared utilities ─────────────────────────────────────────────────────────

  async assertExists(id: string) {
    const content = await this.prisma.content.findFirst({
      where: { id, deletedAt: null },
    })
    if (!content) throw new NotFoundException('Content not found')
    return content
  }

  async appendAuditLog(
    contentId: string,
    event: string,
    actorId: string | null,
    metadata?: object,
  ) {
    await this.prisma.contentAuditLog.create({
      data: { contentId, event, actorId, metadata },
    })
  }

  private async nextVersionNo(contentId: string): Promise<number> {
    const last = await this.prisma.contentVersion.findFirst({
      where: { contentId },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    })
    return (last?.versionNo ?? 0) + 1
  }
}
