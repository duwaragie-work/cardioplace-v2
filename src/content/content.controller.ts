import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { Public } from '../auth/decorators/public.decorator.js'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { RolesGuard } from '../auth/guards/roles.guard.js'
import { UserRole } from '../generated/prisma/enums.js'
import { ContentRatingService } from './content-rating.service.js'
import { ContentService } from './content.service.js'
import { CreateContentDto } from './dto/create-content.dto.js'
import { ListContentQueryDto } from './dto/list-content-query.dto.js'
import { RateContentDto } from './dto/rate-content.dto.js'
import { UpdateContentDto } from './dto/update-content.dto.js'

// ─── Admin roles shorthand ───────────────────────────────────────────────────
const ADMIN_ROLES = [UserRole.CONTENT_ADMIN, UserRole.SUPER_ADMIN]
const SUPER_ADMIN_ONLY = [UserRole.SUPER_ADMIN]

/** Shape of the JWT-authenticated request injected by @Request() */
type AuthRequest = { user: { id: string } }

/** Shape used by public endpoints that may carry an optional user + device header */
type PublicRequest = {
  user?: { id: string }
  headers: Record<string, string | string[] | undefined>
}

@Controller('v2/content')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContentController {
  constructor(
    private readonly contentService: ContentService,
    private readonly contentRatingService: ContentRatingService,
  ) {}

  // ─── Public: list published content ────────────────────────────────────────

  /** GET /v2/content — paginated list of PUBLISHED content (no auth required) */
  @Public()
  @Get()
  listPublished(@Query() query: ListContentQueryDto) {
    return this.contentService.listPublished(query)
  }

  // ─── Admin: list all + full view (routes before :id so /all is not captured as id) ─

  /** GET /v2/content/all — admin view with all statuses */
  @Get('all')
  @Roles(...ADMIN_ROLES)
  listAdmin(@Query() query: ListContentQueryDto) {
    return this.contentService.listAdmin(query)
  }

  /** GET /v2/content/all/:id — full admin view of a single item (by ULID or humanId) */
  @Get('all/:id')
  @Roles(...ADMIN_ROLES)
  findOneAdmin(@Param('id') id: string) {
    if (id.includes('-')) {
      return this.contentService.findOneAdminByHumanId(id)
    }
    return this.contentService.findOneAdmin(id)
  }

  /** GET /v2/content/:id — single published item (by ULID or humanId) + appends ContentView row (no auth required; optional x-device-id for guest view tracking) */
  @Public()
  @Get(':id')
  findOnePublished(@Param('id') id: string, @Request() req: PublicRequest) {
    const userId: string | undefined = req.user?.id
    const deviceId = req.headers['x-device-id']
    const normalizedDeviceId = Array.isArray(deviceId) ? deviceId[0] : deviceId

    if (id.includes('-')) {
      return this.contentService.findOnePublishedByHumanId(id, userId, normalizedDeviceId)
    }

    return this.contentService.findOnePublished(id, userId, normalizedDeviceId)
  }

  /** POST /v2/content — create a new DRAFT */
  @Post()
  @Roles(...ADMIN_ROLES)
  create(@Body() dto: CreateContentDto, @Request() req: AuthRequest) {
    return this.contentService.create(dto, req.user.id)
  }

  /** PATCH /v2/content/:id — edit content (DRAFT only) */
  @Patch(':id')
  @Roles(...ADMIN_ROLES)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateContentDto,
    @Request() req: AuthRequest,
  ) {
    return this.contentService.editContent(id, dto, req.user.id)
  }

  /** POST /v2/content/:id/submit — submit a version for review (initial or revision) */
  @Post(':id/submit')
  @Roles(...ADMIN_ROLES)
  submit(
    @Param('id') id: string,
    @Body() body: { versionNo?: number },
    @Request() req: AuthRequest,
  ) {
    return this.contentService.submitContent(id, req.user.id, body.versionNo)
  }

  /** POST /v2/content/:id/unpublish — take published content offline */
  @Post(':id/unpublish')
  @Roles(...ADMIN_ROLES)
  unpublish(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.contentService.unpublish(id, req.user.id)
  }

  /** POST /v2/content/:id/reopen — re-open UNPUBLISHED content for editing */
  @Post(':id/reopen')
  @Roles(...ADMIN_ROLES)
  reopen(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.contentService.reopenForEditing(id, req.user.id)
  }

  /** DELETE /v2/content/:id — soft-delete content (SUPER_ADMIN only) */
  @Delete(':id')
  @Roles(...SUPER_ADMIN_ONLY)
  remove(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.contentService.softDelete(id, req.user.id)
  }

  /** POST /v2/content/:id/reviewed — manually clear stale flag after review */
  @Post(':id/reviewed')
  @Roles(...ADMIN_ROLES)
  markReviewed(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.contentService.markAsReviewed(id, req.user.id)
  }

  /** POST /v2/content/:id/publish/:versionNo — Super Admin override: force-publish a version */
  @Post(':id/publish/:versionNo')
  @Roles(...SUPER_ADMIN_ONLY)
  superAdminPublish(
    @Param('id') id: string,
    @Param('versionNo', ParseIntPipe) versionNo: number,
    @Body('overrideReason') overrideReason: string,
    @Request() req: AuthRequest,
  ) {
    return this.contentService.superAdminPublish(id, versionNo, overrideReason, req.user.id)
  }

  // ─── Admin: version history + audit log ────────────────────────────────────

  /** GET /content/:id/versions — list version snapshots */
  @Get(':id/versions')
  @Roles(...ADMIN_ROLES)
  listVersions(@Param('id') id: string) {
    return this.contentService.listVersions(id)
  }

  /** GET /content/:id/versions/:versionNo — full snapshot of a version */
  @Get(':id/versions/:versionNo')
  @Roles(...ADMIN_ROLES)
  getVersion(
    @Param('id') id: string,
    @Param('versionNo', ParseIntPipe) versionNo: number,
  ) {
    return this.contentService.getVersion(id, versionNo)
  }

  /** GET /content/:id/audit — full audit event log */
  @Get(':id/audit')
  @Roles(...ADMIN_ROLES)
  getAuditLog(@Param('id') id: string) {
    return this.contentService.getAuditLog(id)
  }

  /** GET /content/:id/views — view count aggregate */
  @Get(':id/views')
  @Roles(...ADMIN_ROLES)
  getViewCount(@Param('id') id: string) {
    return this.contentService.getViewCount(id)
  }

  // ─── Registered Users: ratings ─────────────────────────────────────────────

  /** POST /content/:id/rate — submit or update a 1–5 star rating (registered users only) */
  @Post(':id/rate')
  @Roles(
    UserRole.REGISTERED_USER,
    UserRole.VERIFIED_USER,
    UserRole.CONTENT_ADMIN,
    UserRole.SUPER_ADMIN,
  )
  rate(
    @Param('id') id: string,
    @Body() dto: RateContentDto,
    @Request() req: AuthRequest,
  ) {
    return this.contentRatingService.upsertRating(id, req.user.id, dto)
  }
}
