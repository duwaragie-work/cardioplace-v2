import { jest } from '@jest/globals'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import {
  ContentRevisionStatus,
  ContentStatus,
  ContentType,
} from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ContentService } from './content.service.js'
import { CreateContentDto } from './dto/create-content.dto.js'
import { UpdateContentDto } from './dto/update-content.dto.js'

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const DRAFT_CONTENT = {
  id: 'c-1',
  title: 'Test Article',
  contentType: ContentType.ARTICLE,
  body: 'Body content here',
  summary: 'Short summary',
  author: null,
  tags: ['health'],
  mediaUrl: null,
  status: ContentStatus.DRAFT,
  publishedVersionNo: null,
  revisionStatus: null,
  needsReview: false,
  deletedAt: null,
}

const PUBLISHED_CONTENT = {
  ...DRAFT_CONTENT,
  status: ContentStatus.PUBLISHED,
  publishedVersionNo: 2,
  publishedAt: new Date(),
}

const DRAFT_VERSION = {
  id: 'v-1',
  contentId: 'c-1',
  versionNo: 2,
  snapshotJson: { title: 'Test Article', body: 'Body content here', summary: 'Short summary', tags: ['health'] },
  isDraft: true,
  isPublished: false,
  changeReason: 'draft edit',
  createdById: 'user-1',
  createdAt: new Date(),
}

type RevisionStatusResult = { revisionStatus: ContentRevisionStatus | null }
type UpdateRevisionNoChangeResult = { message: string; versionNo: number | null }
type PublishRevisionResult = { publishedVersionNo: number; revisionStatus: ContentRevisionStatus | null }

describe('ContentService', () => {
  let service: ContentService

  const mockPrisma = {
    content: {
      create: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      findFirst: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      count: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
    },
    contentVersion: {
      create: jest.fn<() => Promise<unknown>>(),
      findFirst: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
    },
    contentAuditLog: {
      create: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
    },
    contentView: {
      create: jest.fn<() => Promise<unknown>>(),
      count: jest.fn<() => Promise<unknown>>(),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: PrismaService, useValue: mockPrisma as unknown as PrismaService },
      ],
    }).compile()

    service = module.get<ContentService>(ContentService)
    jest.clearAllMocks()

    // Default safe resolutions
    jest.mocked(mockPrisma.contentView.create).mockResolvedValue(null)
    jest.mocked(mockPrisma.contentAuditLog.create).mockResolvedValue(null)
    jest.mocked(mockPrisma.contentVersion.updateMany).mockResolvedValue({ count: 1 })
    jest.mocked(mockPrisma.contentVersion.update).mockResolvedValue(null)
    // nextVersionNo → returns versionNo = 1 by default
    jest.mocked(mockPrisma.contentVersion.findFirst).mockResolvedValue(null)
  })

  // ─── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    const actorId = 'user-1'
    const dto: CreateContentDto = {
      title: 'Test Article',
      contentType: ContentType.ARTICLE,
      body: 'Body content here',
      summary: 'Short summary',
      tags: ['health'],
    }

    it('creates content with DRAFT status', async () => {
      jest.mocked(mockPrisma.content.create).mockResolvedValue(DRAFT_CONTENT)

      const result = await service.create(dto, actorId)

      expect(result).toEqual(DRAFT_CONTENT)
      expect(mockPrisma.content.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: ContentStatus.DRAFT, submittedById: actorId }),
      })
    })

    it('immediately creates an initial ContentVersion with isDraft=true (Bug 2 fix)', async () => {
      jest.mocked(mockPrisma.content.create).mockResolvedValue(DRAFT_CONTENT)

      await service.create(dto, actorId)

      expect(mockPrisma.contentVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          versionNo: 1,
          isDraft: true,
          isPublished: false,
          changeReason: 'initial draft',
          createdById: actorId,
        }),
      })
    })

    it('writes a create audit log entry', async () => {
      jest.mocked(mockPrisma.content.create).mockResolvedValue(DRAFT_CONTENT)

      await service.create(dto, actorId)

      expect(mockPrisma.contentAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ event: 'create', actorId }),
      })
    })

    it('defaults optional fields to null / empty array', async () => {
      const minimalDto: CreateContentDto = {
        title: 'Minimal',
        contentType: ContentType.TIP,
        body: 'Body',
        summary: 'Summary',
      }
      jest.mocked(mockPrisma.content.create).mockResolvedValue({ ...DRAFT_CONTENT, ...minimalDto })

      await service.create(minimalDto, actorId)

      expect(mockPrisma.content.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ author: null, tags: [], mediaUrl: null }),
      })
    })
  })

  // ─── listPublished ───────────────────────────────────────────────────────────

  describe('listPublished', () => {
    it('returns paginated published items with needsReview=false filter', async () => {
      jest.mocked(mockPrisma.content.findMany).mockResolvedValue([PUBLISHED_CONTENT])
      jest.mocked(mockPrisma.content.count).mockResolvedValue(1)

      const result = await service.listPublished({})

      expect(result).toEqual({ items: [PUBLISHED_CONTENT], total: 1, page: 1, limit: 20 })
      expect(mockPrisma.content.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: ContentStatus.PUBLISHED, needsReview: false }),
        }),
      )
    })

    it('applies contentType filter', async () => {
      jest.mocked(mockPrisma.content.findMany).mockResolvedValue([])
      jest.mocked(mockPrisma.content.count).mockResolvedValue(0)

      await service.listPublished({ type: ContentType.ARTICLE })

      expect(mockPrisma.content.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ contentType: ContentType.ARTICLE }),
        }),
      )
    })

    it('respects page and limit', async () => {
      jest.mocked(mockPrisma.content.findMany).mockResolvedValue([])
      jest.mocked(mockPrisma.content.count).mockResolvedValue(0)

      const result = await service.listPublished({ page: 3, limit: 5 })

      expect(result.page).toBe(3)
      expect(result.limit).toBe(5)
      expect(mockPrisma.content.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 5 }),
      )
    })
  })

  // ─── update ──────────────────────────────────────────────────────────────────

  describe('update (initial DRAFT only)', () => {
    const id = 'c-1'
    const actorId = 'user-1'
    const dto: UpdateContentDto = { title: 'Updated Title' }

    it('creates a new version snapshot when a field changes', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(DRAFT_CONTENT)
      jest.mocked(mockPrisma.content.update).mockResolvedValue({ ...DRAFT_CONTENT, title: 'Updated Title' })

      await service.update(id, dto, actorId)

      expect(mockPrisma.contentVersion.updateMany).toHaveBeenCalledWith({
        where: { contentId: id, isDraft: true },
        data: { isDraft: false },
      })
      expect(mockPrisma.contentVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isDraft: true, changeReason: 'draft edit' }),
        }),
      )
    })

    it('does NOT create a version when no content fields changed', async () => {
      // Pass a dto where the title is the SAME as the existing content
      const sameDto: UpdateContentDto = { title: DRAFT_CONTENT.title }
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(DRAFT_CONTENT)
      jest.mocked(mockPrisma.content.update).mockResolvedValue(DRAFT_CONTENT)

      await service.update(id, sameDto, actorId)

      expect(mockPrisma.contentVersion.create).not.toHaveBeenCalled()
    })

    it('throws BadRequestException when content is already published (use /revision instead)', async () => {
      jest
        .mocked(mockPrisma.content.findUnique)
        .mockResolvedValue({ ...PUBLISHED_CONTENT }) // publishedVersionNo = 2

      await expect(service.update(id, dto, actorId)).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when content is IN_REVIEW', async () => {
      jest
        .mocked(mockPrisma.content.findUnique)
        .mockResolvedValue({ ...DRAFT_CONTENT, status: ContentStatus.IN_REVIEW })

      await expect(service.update(id, dto, actorId)).rejects.toThrow(BadRequestException)
    })

    it('throws NotFoundException when content does not exist', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(null)

      await expect(service.update(id, dto, actorId)).rejects.toThrow(NotFoundException)
    })
  })

  // ─── submitForReview ─────────────────────────────────────────────────────────

  describe('submitForReview', () => {
    const id = 'c-1'
    const actorId = 'user-1'

    it('transitions DRAFT to IN_REVIEW', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(DRAFT_CONTENT)
      jest.mocked(mockPrisma.content.update).mockResolvedValue({ ...DRAFT_CONTENT, status: ContentStatus.IN_REVIEW })

      const result = await service.submitForReview(id, actorId)

      expect(result.status).toBe(ContentStatus.IN_REVIEW)
    })

    it('does NOT create a ContentVersion (Bug 1 fix — state transitions are not versioned)', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(DRAFT_CONTENT)
      jest.mocked(mockPrisma.content.update).mockResolvedValue({ ...DRAFT_CONTENT, status: ContentStatus.IN_REVIEW })

      await service.submitForReview(id, actorId)

      expect(mockPrisma.contentVersion.create).not.toHaveBeenCalled()
    })

    it('writes a submit_review audit log entry', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(DRAFT_CONTENT)
      jest.mocked(mockPrisma.content.update).mockResolvedValue({ ...DRAFT_CONTENT, status: ContentStatus.IN_REVIEW })

      await service.submitForReview(id, actorId)

      expect(mockPrisma.contentAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ event: 'submit_review' }),
      })
    })

    it('throws BadRequestException when content is not DRAFT', async () => {
      jest
        .mocked(mockPrisma.content.findUnique)
        .mockResolvedValue({ ...DRAFT_CONTENT, status: ContentStatus.PUBLISHED, publishedVersionNo: 1 })

      await expect(service.submitForReview(id, actorId)).rejects.toThrow(BadRequestException)
    })
  })

  // ─── publishAfterDualApproval ────────────────────────────────────────────────

  describe('publishAfterDualApproval', () => {
    const id = 'c-1'
    const actorId = 'rev-1'

    it('marks current isDraft version as isPublished, sets publishedVersionNo', async () => {
      const content = { ...DRAFT_CONTENT, status: ContentStatus.PARTIALLY_APPROVED }
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(content)
      jest.mocked(mockPrisma.contentVersion.findFirst).mockResolvedValue(DRAFT_VERSION)
      jest.mocked(mockPrisma.content.update).mockResolvedValue({ ...content, status: ContentStatus.PUBLISHED })

      const result = await service.publishAfterDualApproval(id, actorId)

      expect(result.status).toBe(ContentStatus.PUBLISHED)
      expect(mockPrisma.contentVersion.update).toHaveBeenCalledWith({
        where: { contentId_versionNo: { contentId: id, versionNo: DRAFT_VERSION.versionNo } },
        data: { isDraft: false, isPublished: true },
      })
    })

    it('does NOT create a new ContentVersion (Bug 1 fix)', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(DRAFT_CONTENT)
      jest.mocked(mockPrisma.contentVersion.findFirst).mockResolvedValue(DRAFT_VERSION)
      jest.mocked(mockPrisma.content.update).mockResolvedValue({ ...DRAFT_CONTENT, status: ContentStatus.PUBLISHED })

      await service.publishAfterDualApproval(id, actorId)

      expect(mockPrisma.contentVersion.create).not.toHaveBeenCalled()
    })

    it('throws NotFoundException when no draft version found', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(DRAFT_CONTENT)
      jest.mocked(mockPrisma.contentVersion.findFirst).mockResolvedValue(null) // no draft

      await expect(service.publishAfterDualApproval(id, actorId)).rejects.toThrow(NotFoundException)
    })
  })

  // ─── revertToDraftAfterRejection ─────────────────────────────────────────────

  describe('revertToDraftAfterRejection', () => {
    const id = 'c-1'

    it('reverts status to DRAFT', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue({ ...DRAFT_CONTENT, status: ContentStatus.IN_REVIEW })
      jest.mocked(mockPrisma.content.update).mockResolvedValue({ ...DRAFT_CONTENT, status: ContentStatus.DRAFT })

      const result = await service.revertToDraftAfterRejection(id, 'rev-1', ContentStatus.IN_REVIEW)

      expect(result.status).toBe(ContentStatus.DRAFT)
    })

    it('does NOT create a new ContentVersion (Bug 1 fix)', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue({ ...DRAFT_CONTENT, status: ContentStatus.IN_REVIEW })
      jest.mocked(mockPrisma.content.update).mockResolvedValue(DRAFT_CONTENT)

      await service.revertToDraftAfterRejection(id, 'rev-1', ContentStatus.IN_REVIEW)

      expect(mockPrisma.contentVersion.create).not.toHaveBeenCalled()
    })
  })

  // ─── unpublish ───────────────────────────────────────────────────────────────

  describe('unpublish', () => {
    const id = 'c-1'
    const actorId = 'admin-1'

    it('transitions PUBLISHED to UNPUBLISHED and clears publishedVersionNo', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(PUBLISHED_CONTENT)
      jest.mocked(mockPrisma.content.update).mockResolvedValue({
        ...PUBLISHED_CONTENT,
        status: ContentStatus.UNPUBLISHED,
        publishedVersionNo: null,
      })

      const result = await service.unpublish(id, actorId)

      expect(result.status).toBe(ContentStatus.UNPUBLISHED)
      expect(mockPrisma.contentVersion.updateMany).toHaveBeenCalledWith({
        where: { contentId: id, isPublished: true },
        data: { isPublished: false },
      })
    })

    it('throws BadRequestException when not PUBLISHED', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(DRAFT_CONTENT)

      await expect(service.unpublish(id, actorId)).rejects.toThrow(BadRequestException)
    })
  })

  // ─── startRevision (Option B) ────────────────────────────────────────────────

  describe('startRevision', () => {
    const id = 'c-1'
    const actorId = 'admin-1'

    it('sets revisionStatus=DRAFT and does NOT create a placeholder version', async () => {
      jest.mocked(mockPrisma.content.findFirst).mockResolvedValue(PUBLISHED_CONTENT)
      jest.mocked(mockPrisma.content.update).mockResolvedValue({
        ...PUBLISHED_CONTENT,
        revisionStatus: ContentRevisionStatus.DRAFT,
      })

      const result = await service.startRevision(id, actorId) as unknown as RevisionStatusResult

      expect(result.revisionStatus).toBe(ContentRevisionStatus.DRAFT)
      expect(mockPrisma.contentVersion.create).not.toHaveBeenCalled()
      expect(mockPrisma.contentAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ event: 'revision_started' }) })
      )
    })

    it('throws BadRequestException when content is not PUBLISHED', async () => {
      jest.mocked(mockPrisma.content.findFirst).mockResolvedValue(DRAFT_CONTENT)

      await expect(service.startRevision(id, actorId)).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when a revision is already in progress', async () => {
      jest.mocked(mockPrisma.content.findFirst).mockResolvedValue({
        ...PUBLISHED_CONTENT,
        revisionStatus: ContentRevisionStatus.DRAFT,
      })

      await expect(service.startRevision(id, actorId)).rejects.toThrow(BadRequestException)
    })
  })

  // ─── updateRevision (Option B) ───────────────────────────────────────────────

  describe('updateRevision', () => {
    const id = 'c-1'
    const actorId = 'admin-1'
    const publishedWithRevision = {
      ...PUBLISHED_CONTENT,
      revisionStatus: ContentRevisionStatus.DRAFT,
    }

    it('creates the first draft version by comparing against live content (optimization)', async () => {
      jest.mocked(mockPrisma.content.findFirst).mockResolvedValue(publishedWithRevision)
      jest.mocked(mockPrisma.contentVersion.findFirst).mockResolvedValueOnce(null) // no current draft
      jest.mocked(mockPrisma.contentVersion.findUnique).mockResolvedValue({ ...DRAFT_VERSION, isDraft: false }) // live base
      jest.mocked(mockPrisma.contentVersion.findFirst).mockResolvedValueOnce({ versionNo: 2 }) // nextVersionNo
      jest.mocked(mockPrisma.contentVersion.create).mockResolvedValue(null)

      await service.updateRevision(id, { body: 'First revision change' }, actorId)

      expect(mockPrisma.contentVersion.update).not.toHaveBeenCalled() // no draft to retire
      expect(mockPrisma.contentVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isDraft: true, changeReason: 'revision draft edit' }),
        }),
      )
    })

    it('retires current draft and creates a new one on subsequent edits', async () => {
      jest.mocked(mockPrisma.content.findFirst).mockResolvedValue(publishedWithRevision)
      jest.mocked(mockPrisma.contentVersion.findFirst)
        .mockResolvedValueOnce(DRAFT_VERSION)        // current draft exists
        .mockResolvedValueOnce({ versionNo: 2 })     // nextVersionNo
      jest.mocked(mockPrisma.contentVersion.update).mockResolvedValue(null)
      jest.mocked(mockPrisma.contentVersion.create).mockResolvedValue(null)

      await service.updateRevision(id, { body: 'Subsequent change' }, actorId)

      expect(mockPrisma.contentVersion.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isDraft: false } }),
      )
      expect(mockPrisma.contentVersion.create).toHaveBeenCalled()
    })

    it('returns a no-change message when no fields changed', async () => {
      // Snapshot matches the incoming dto exactly
      const unchangedDraft = { ...DRAFT_VERSION, snapshotJson: { title: 'Test Article', body: 'Body content here', summary: 'Short summary', tags: ['health'] } }
      jest.mocked(mockPrisma.content.findFirst).mockResolvedValue(publishedWithRevision)
      jest.mocked(mockPrisma.contentVersion.findFirst).mockResolvedValueOnce(unchangedDraft)

      const result = await service.updateRevision(id, { title: 'Test Article' }, actorId) as unknown as UpdateRevisionNoChangeResult

      expect(result.message).toMatch(/No content fields changed/)
      expect(mockPrisma.contentVersion.create).not.toHaveBeenCalled()
    })

    it('throws BadRequestException when revisionStatus is not DRAFT', async () => {
      jest.mocked(mockPrisma.content.findFirst).mockResolvedValue({
        ...PUBLISHED_CONTENT,
        revisionStatus: ContentRevisionStatus.IN_REVIEW,
      })

      await expect(service.updateRevision(id, { title: 'New Title' }, actorId)).rejects.toThrow(BadRequestException)
    })
  })

  // ─── submitRevisionForReview (Option B) ──────────────────────────────────────

  describe('submitRevisionForReview', () => {
    const id = 'c-1'
    const actorId = 'admin-1'

    it('sets revisionStatus to IN_REVIEW when a draft version exists', async () => {
      jest.mocked(mockPrisma.content.findFirst).mockResolvedValue({
        ...PUBLISHED_CONTENT,
        revisionStatus: ContentRevisionStatus.DRAFT,
      })
      jest.mocked(mockPrisma.contentVersion.findFirst).mockResolvedValue(DRAFT_VERSION) // draft exists
      jest.mocked(mockPrisma.content.update).mockResolvedValue({
        ...PUBLISHED_CONTENT,
        revisionStatus: ContentRevisionStatus.IN_REVIEW,
      })

      const result = await service.submitRevisionForReview(id, actorId) as unknown as RevisionStatusResult

      expect(result.revisionStatus).toBe(ContentRevisionStatus.IN_REVIEW)
    })

    it('throws BadRequestException if no changes (no draft versions) were made', async () => {
      jest.mocked(mockPrisma.content.findFirst).mockResolvedValue({
        ...PUBLISHED_CONTENT,
        revisionStatus: ContentRevisionStatus.DRAFT,
      })
      jest.mocked(mockPrisma.contentVersion.findFirst).mockResolvedValue(null) // no draft

      await expect(service.submitRevisionForReview(id, actorId)).rejects.toThrow(
        /No changes have been made yet/
      )
    })

    it('throws BadRequestException when revisionStatus is not DRAFT', async () => {
      jest.mocked(mockPrisma.content.findFirst).mockResolvedValue(PUBLISHED_CONTENT) // revisionStatus null

      await expect(service.submitRevisionForReview(id, actorId)).rejects.toThrow(BadRequestException)
    })
  })

  // ─── publishRevisionAfterDualApproval (Option B) ─────────────────────────────

  describe('publishRevisionAfterDualApproval', () => {
    const id = 'c-1'
    const actorId = 'rev-1'

    it('promotes revision draft to live, clears revisionStatus, updates Content fields', async () => {
      const revisedDraft = { ...DRAFT_VERSION, versionNo: 4, isDraft: true }
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(PUBLISHED_CONTENT)
      jest.mocked(mockPrisma.contentVersion.findFirst).mockResolvedValue(revisedDraft)
      jest.mocked(mockPrisma.content.update).mockResolvedValue({
        ...PUBLISHED_CONTENT,
        publishedVersionNo: 4,
        revisionStatus: null,
      })

      const result = await service.publishRevisionAfterDualApproval(id, actorId) as unknown as PublishRevisionResult

      expect(result.publishedVersionNo).toBe(4)
      expect(result.revisionStatus).toBeNull()
      expect(mockPrisma.contentVersion.updateMany).toHaveBeenCalledWith({
        where: { contentId: id, isPublished: true },
        data: { isPublished: false },
      })
      expect(mockPrisma.contentVersion.update).toHaveBeenCalledWith({
        where: { contentId_versionNo: { contentId: id, versionNo: 4 } },
        data: { isDraft: false, isPublished: true },
      })
    })

    it('does NOT create a new version', async () => {
      jest.mocked(mockPrisma.content.findUnique).mockResolvedValue(PUBLISHED_CONTENT)
      jest.mocked(mockPrisma.contentVersion.findFirst).mockResolvedValue(DRAFT_VERSION)
      jest.mocked(mockPrisma.content.update).mockResolvedValue(PUBLISHED_CONTENT)

      await service.publishRevisionAfterDualApproval(id, actorId)

      expect(mockPrisma.contentVersion.create).not.toHaveBeenCalled()
    })
  })

  // ─── softDelete ──────────────────────────────────────────────────────────────

  describe('softDelete', () => {
    const id = 'c-1'
    const actorId = 'super-admin-1'

    it('sets deletedAt and clears live version flag for PUBLISHED content', async () => {
      jest.mocked(mockPrisma.content.findFirst).mockResolvedValue(PUBLISHED_CONTENT)
      jest.mocked(mockPrisma.content.update).mockResolvedValue({ ...PUBLISHED_CONTENT, deletedAt: new Date() })

      await service.softDelete(id, actorId)

      expect(mockPrisma.contentVersion.updateMany).toHaveBeenCalledWith({
        where: { contentId: id, isPublished: true },
        data: { isPublished: false },
      })
    })

    it('returns a success message object', async () => {
      jest.mocked(mockPrisma.content.findFirst).mockResolvedValue({ ...DRAFT_CONTENT })
      jest.mocked(mockPrisma.content.update).mockResolvedValue({ id, deletedAt: new Date() })

      const result = await service.softDelete(id, actorId)

      expect(result).toEqual({ message: 'Content soft-deleted successfully', contentId: id })
    })

    it('throws NotFoundException when already soft-deleted', async () => {
      jest.mocked(mockPrisma.content.findFirst).mockResolvedValue(null)

      await expect(service.softDelete(id, actorId)).rejects.toThrow(NotFoundException)
    })
  })

  // ─── getViewCount ────────────────────────────────────────────────────────────

  describe('getViewCount', () => {
    it('returns the view count', async () => {
      jest.mocked(mockPrisma.content.findFirst).mockResolvedValue({ id: 'c-1', deletedAt: null })
      jest.mocked(mockPrisma.contentView.count).mockResolvedValue(42)

      const result = await service.getViewCount('c-1')

      expect(result).toEqual({ contentId: 'c-1', viewCount: 42 })
    })
  })
})
