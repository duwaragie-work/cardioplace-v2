import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { UserRole } from '../generated/prisma/enums.js'
import { DailyJournalService } from './daily_journal.service.js'
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto.js'
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto.js'
import { UpdateNotificationStatusDto } from './dto/update-notification-status.dto.js'
import { BulkUpdateNotificationStatusDto } from './dto/bulk-update-notification-status.dto.js'

/**
 * Roles allowed to read/ack their OWN notification feed. The admin app's
 * NotificationBell + /notifications inbox poll the same daily-journal
 * notification routes as the patient app — every notification query is
 * scoped to `req.user.id`, so each role only ever sees its own rows, and the
 * universal BELL_VISIBLE_NOTIFICATION_FILTER (G.4) applies identically for
 * both apps (clinical alerts live in the patient-detail Alerts tab, not the
 * bell). Patient journal mutations stay PATIENT-only via the class decorator.
 */
const NOTIFICATION_FEED_ROLES = [
  UserRole.PATIENT,
  UserRole.PROVIDER,
  UserRole.MEDICAL_DIRECTOR,
  UserRole.HEALPLACE_OPS,
  UserRole.SUPER_ADMIN,
] as const

/**
 * Patient-side journal endpoints — create / update / list / delete the
 * logged-in patient's own readings. Role-gated via the global RolesGuard:
 * only PATIENT may hit these routes (PROVIDER/admin views the same data via
 * the separate admin app endpoints with different ownership semantics). The
 * notification feed/status routes below override this to also admit
 * care-team roles (see NOTIFICATION_FEED_ROLES).
 */
@Controller('daily-journal')
@UseGuards(JwtAuthGuard)
@Roles(UserRole.PATIENT)
export class DailyJournalController {
  constructor(private readonly dailyJournalService: DailyJournalService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(@Req() req: Request, @Body() dto: CreateJournalEntryDto) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.create(userId, dto)
  }

  @Put(':id')
  @HttpCode(HttpStatus.ACCEPTED)
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateJournalEntryDto,
  ) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.update(userId, id, dto)
  }

  @Get()
  findAll(
    @Req() req: Request,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    const { id: userId } = req.user as { id: string }
    const l = limit ? Math.min(Math.max(1, parseInt(limit, 10) || 50), 200) : undefined
    return this.dailyJournalService.findAll(userId, startDate, endDate, l)
  }

  @Get('history')
  getHistory(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { id: userId } = req.user as { id: string }
    const p = Math.max(1, parseInt(page ?? '1', 10) || 1)
    const l = Math.min(50, Math.max(1, parseInt(limit ?? '10', 10) || 10))
    return this.dailyJournalService.getHistory(userId, p, l)
  }

  @Get('alerts')
  getAlerts(@Req() req: Request) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.getAlerts(userId)
  }

  @Get('notifications')
  @Roles(...NOTIFICATION_FEED_ROLES)
  getNotifications(
    @Req() req: Request,
    @Query('status') status?: 'all' | 'unread' | 'read',
  ) {
    const { id: userId } = req.user as { id: string }
    const normalizedStatus: 'all' | 'unread' | 'read' =
      status === 'unread' || status === 'read' || status === 'all'
        ? status
        : 'all'
    return this.dailyJournalService.getNotifications(userId, normalizedStatus)
  }

  @Patch('notifications/bulk-status')
  @Roles(...NOTIFICATION_FEED_ROLES)
  bulkUpdateNotificationStatus(
    @Req() req: Request,
    @Body() dto: BulkUpdateNotificationStatusDto,
  ) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.bulkUpdateNotificationStatus(
      userId,
      dto.ids,
      dto.watched,
    )
  }

  // Unread count for the bell badge. Works for any authenticated role —
  // the admin bell polls this every 30s; the patient app uses the same
  // endpoint via the existing notifications page. Excludes EMAIL channel
  // (those rows are tracking-only and don't represent in-app unread state).
  // Declared BEFORE notifications/:id so Express matches the literal path.
  @Get('notifications/unread-count')
  @Roles(...NOTIFICATION_FEED_ROLES)
  getNotificationsUnreadCount(@Req() req: Request) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.getNotificationsUnreadCount(userId)
  }

  @Get('notifications/:id')
  @Roles(...NOTIFICATION_FEED_ROLES)
  getNotification(@Req() req: Request, @Param('id') id: string) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.getNotificationById(userId, id)
  }

  @Patch('notifications/:id/status')
  @Roles(...NOTIFICATION_FEED_ROLES)
  updateNotificationStatus(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateNotificationStatusDto,
  ) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.updateNotificationStatus(
      userId,
      id,
      dto.watched,
    )
  }

  @Get('stats')
  getStats(@Req() req: Request) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.getStats(userId)
  }

  @Get('escalations')
  getEscalations(@Req() req: Request) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.getEscalations(userId)
  }

  @Get('baseline/latest')
  getLatestBaseline(@Req() req: Request) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.getLatestBaseline(userId)
  }

  // The patient's currently-open reading session (or null). Drives the
  // check-in "add to this session or start new?" prompt. Declared BEFORE
  // the `:id` catch-all so Express matches the literal path.
  @Get('active-session')
  getActiveSession(@Req() req: Request) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.getActiveSession(userId)
  }

  // Option D (Manisha 2026-06-12 Q2) — the patient's most recent held emergency
  // reading awaiting its confirmatory second reading (or null). Drives the
  // /check-in Screen A auto-resume + the /readings "Continue confirmation" CTA.
  // Declared BEFORE the `:id` catch-all so Express matches the literal path.
  @Get('awaiting-emergency')
  getAwaitingEmergency(@Req() req: Request) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.getAwaitingEmergency(userId)
  }

  @Get(':id')
  findOne(@Req() req: Request, @Param('id') id: string) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.findOne(userId, id)
  }

  @Delete(':id')
  delete(@Req() req: Request, @Param('id') id: string) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.delete(userId, id)
  }

  /**
   * Cluster 6 Q2 (Manisha 5/9/26) — frontend's 5-min "take a second
   * reading" timer elapsed. Flip the entry's `singleReadingFinalized`
   * flag and re-evaluate so the alert fires on the lone reading with
   * the "confirm with next reading" annotation.
   */
  @Post(':id/finalize-single-reading')
  finalizeSingleReadingSession(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.finalizeSingleReadingSession(userId, id)
  }

  /**
   * Option D (Manisha 2026-06-12 Q2) — patient declined / closed the
   * confirmatory retake (Screen C), or the 5-min window elapsed client-side.
   * Resolves the held AWAITING first-of-pair as UNCONFIRMED, firing
   * RULE_UNCONFIRMED_EMERGENCY (Tier 1 provider-only). The SessionFinalizeService
   * cron is the app-closed safety net that calls the same service method.
   */
  @Post(':id/decline-confirmation')
  declineEmergencyConfirmation(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.finalizeUnconfirmedEmergency(userId, id)
  }

  @Patch('alerts/:id/acknowledge')
  acknowledgeAlert(@Req() req: Request, @Param('id') id: string) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.acknowledgeAlert(userId, id)
  }
}
