import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { ContentStatus, ContentType } from '../generated/prisma/enums.js'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { RolesGuard } from '../auth/guards/roles.guard.js'
import { ContentRatingService } from './content-rating.service.js'
import { ContentController } from './content.controller.js'
import { ContentService } from './content.service.js'
import { CreateContentDto } from './dto/create-content.dto.js'
import { ListContentQueryDto } from './dto/list-content-query.dto.js'
import { RateContentDto } from './dto/rate-content.dto.js'
import { UpdateContentDto } from './dto/update-content.dto.js'

const mockContentService = {
  listPublished: jest.fn(),
  findOnePublished: jest.fn(),
  findOnePublishedByHumanId: jest.fn(),
  listAdmin: jest.fn(),
  findOneAdmin: jest.fn(),
  findOneAdminByHumanId: jest.fn(),
  create: jest.fn(),
  editContent: jest.fn(),
  submitContent: jest.fn(),
  unpublish: jest.fn(),
  reopenForEditing: jest.fn(),
  softDelete: jest.fn(),
  markAsReviewed: jest.fn(),
  superAdminPublish: jest.fn(),
  listVersions: jest.fn(),
  getVersion: jest.fn(),
  getAuditLog: jest.fn(),
  getViewCount: jest.fn(),
}

const mockContentRatingService = {
  upsertRating: jest.fn(),
}

describe('ContentController', () => {
  let controller: ContentController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContentController],
      providers: [
        { provide: ContentService, useValue: mockContentService },
        { provide: ContentRatingService, useValue: mockContentRatingService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get<ContentController>(ContentController)
    jest.clearAllMocks()
  })

  const authReq = { user: { id: 'user-1' } }

  // ─── Public endpoints ────────────────────────────────────────────────────────

  describe('listPublished', () => {
    it('delegates to contentService.listPublished', () => {
      const query: ListContentQueryDto = { type: ContentType.ARTICLE }
      mockContentService.listPublished.mockReturnValue({ items: [], total: 0, page: 1, limit: 20 })

      controller.listPublished(query)

      expect(mockContentService.listPublished).toHaveBeenCalledWith(query)
    })
  })

  describe('findOnePublished', () => {
    it('delegates to contentService.findOnePublished with userId and deviceId when id looks like ULID', () => {
      const req = {
        user: { id: 'u-1' },
        headers: { 'x-device-id': 'device-abc' },
      }
      mockContentService.findOnePublished.mockReturnValue({ id: 'c-1' })

      controller.findOnePublished('c1', req)

      expect(mockContentService.findOnePublished).toHaveBeenCalledWith('c1', 'u-1', 'device-abc')
    })

    it('passes undefined userId for unauthenticated requests when id looks like ULID', () => {
      const req = { user: undefined, headers: {} }
      mockContentService.findOnePublished.mockReturnValue({ id: 'c-1' })

      controller.findOnePublished('c1', req)

      expect(mockContentService.findOnePublished).toHaveBeenCalledWith('c1', undefined, undefined)
    })
    it('delegates to contentService.findOnePublishedByHumanId when id looks like humanId', () => {
      const req = {
        user: { id: 'u-1' },
        headers: { 'x-device-id': 'device-abc' },
      }
      mockContentService.findOnePublishedByHumanId.mockReturnValue({ id: 'c-1' })

      controller.findOnePublished('ART-ABC123', req)

      expect(mockContentService.findOnePublishedByHumanId).toHaveBeenCalledWith(
        'ART-ABC123',
        'u-1',
        'device-abc',
      )
    })
  })

  // ─── Admin endpoints ─────────────────────────────────────────────────────────

  describe('listAdmin', () => {
    it('delegates to contentService.listAdmin', () => {
      const query: ListContentQueryDto = { status: ContentStatus.IN_REVIEW }
      mockContentService.listAdmin.mockReturnValue({ items: [], total: 0 })

      controller.listAdmin(query)

      expect(mockContentService.listAdmin).toHaveBeenCalledWith(query)
    })
  })

  describe('findOneAdmin', () => {
    it('delegates to contentService.findOneAdmin when id looks like ULID', () => {
      mockContentService.findOneAdmin.mockReturnValue({ id: 'c-1' })

      controller.findOneAdmin('c1')

      expect(mockContentService.findOneAdmin).toHaveBeenCalledWith('c1')
    })
    it('delegates to contentService.findOneAdminByHumanId when id looks like humanId', () => {
      mockContentService.findOneAdminByHumanId.mockReturnValue({ id: 'c-1' })

      controller.findOneAdmin('ART-ABC123')

      expect(mockContentService.findOneAdminByHumanId).toHaveBeenCalledWith('ART-ABC123')
    })
  })

  describe('create', () => {
    it('delegates to contentService.create with actorId from request', () => {
      const dto: CreateContentDto = {
        title: 'Test',
        contentType: ContentType.ARTICLE,
        body: 'Body content',
        summary: 'A summary',
      }
      mockContentService.create.mockReturnValue({ id: 'c-1' })

      controller.create(dto, authReq)

      expect(mockContentService.create).toHaveBeenCalledWith(dto, 'user-1')
    })
  })

  describe('update', () => {
    it('delegates to contentService.editContent with actorId', () => {
      const dto: UpdateContentDto = { title: 'Updated' }
      mockContentService.editContent.mockReturnValue({ id: 'c-1' })

      controller.update('c-1', dto, authReq)

      expect(mockContentService.editContent).toHaveBeenCalledWith('c-1', dto, 'user-1')
    })
  })

  describe('submit', () => {
    it('delegates to contentService.submitContent with undefined versionNo by default', () => {
      mockContentService.submitContent.mockReturnValue({ status: ContentStatus.IN_REVIEW })

      controller.submit('c-1', {}, authReq)

      expect(mockContentService.submitContent).toHaveBeenCalledWith('c-1', 'user-1', undefined)
    })
  })

  describe('unpublish', () => {
    it('delegates to contentService.unpublish', () => {
      mockContentService.unpublish.mockReturnValue({ status: ContentStatus.UNPUBLISHED })

      controller.unpublish('c-1', authReq)

      expect(mockContentService.unpublish).toHaveBeenCalledWith('c-1', 'user-1')
    })
  })

  describe('reopen', () => {
    it('delegates to contentService.reopenForEditing', () => {
      mockContentService.reopenForEditing.mockReturnValue({ status: ContentStatus.DRAFT })

      controller.reopen('c-1', authReq)

      expect(mockContentService.reopenForEditing).toHaveBeenCalledWith('c-1', 'user-1')
    })
  })

  describe('remove', () => {
    it('delegates to contentService.softDelete', () => {
      mockContentService.softDelete.mockReturnValue({ message: 'deleted' })

      controller.remove('c-1', authReq)

      expect(mockContentService.softDelete).toHaveBeenCalledWith('c-1', 'user-1')
    })
  })

  describe('markReviewed', () => {
    it('delegates to contentService.markAsReviewed', () => {
      mockContentService.markAsReviewed.mockReturnValue({ id: 'c-1' })

      controller.markReviewed('c-1', authReq)

      expect(mockContentService.markAsReviewed).toHaveBeenCalledWith('c-1', 'user-1')
    })
  })

  describe('superAdminPublish', () => {
    it('delegates to contentService.superAdminPublish with all params', () => {
      mockContentService.superAdminPublish.mockReturnValue({ status: ContentStatus.PUBLISHED })

      controller.superAdminPublish('c-1', 3, 'Urgent fix', authReq)

      expect(mockContentService.superAdminPublish).toHaveBeenCalledWith(
        'c-1',
        3,
        'Urgent fix',
        'user-1',
      )
    })
  })

  // ─── Version / audit endpoints ───────────────────────────────────────────────

  describe('listVersions', () => {
    it('delegates to contentService.listVersions', () => {
      mockContentService.listVersions.mockReturnValue([])

      controller.listVersions('c-1')

      expect(mockContentService.listVersions).toHaveBeenCalledWith('c-1')
    })
  })

  describe('getVersion', () => {
    it('delegates to contentService.getVersion', () => {
      mockContentService.getVersion.mockReturnValue({ versionNo: 2 })

      controller.getVersion('c-1', 2)

      expect(mockContentService.getVersion).toHaveBeenCalledWith('c-1', 2)
    })
  })

  describe('getAuditLog', () => {
    it('delegates to contentService.getAuditLog', () => {
      mockContentService.getAuditLog.mockReturnValue([])

      controller.getAuditLog('c-1')

      expect(mockContentService.getAuditLog).toHaveBeenCalledWith('c-1')
    })
  })

  describe('getViewCount', () => {
    it('delegates to contentService.getViewCount', () => {
      mockContentService.getViewCount.mockReturnValue({ viewCount: 10 })

      controller.getViewCount('c-1')

      expect(mockContentService.getViewCount).toHaveBeenCalledWith('c-1')
    })
  })

  // ─── Rating endpoint ─────────────────────────────────────────────────────────

  describe('rate', () => {
    it('delegates to contentRatingService.upsertRating', () => {
      const dto: RateContentDto = { ratingValue: 5 }
      mockContentRatingService.upsertRating.mockReturnValue({ message: 'Rating saved successfully' })

      controller.rate('c-1', dto, authReq)

      expect(mockContentRatingService.upsertRating).toHaveBeenCalledWith('c-1', 'user-1', dto)
    })
  })
})
