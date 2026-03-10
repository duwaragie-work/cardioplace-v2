import {
  Body,
  Controller,
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
import { DailyJournalService } from './daily_journal.service.js'
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto.js'
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto.js'
import { UpdateNotificationStatusDto } from './dto/update-notification-status.dto.js'
import { BulkUpdateNotificationStatusDto } from './dto/bulk-update-notification-status.dto.js'

@Controller('daily-journal')
@UseGuards(JwtAuthGuard)
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
  findAll(@Req() req: Request) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.findAll(userId)
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

  @Get('notifications/:id')
  getNotification(@Req() req: Request, @Param('id') id: string) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.getNotificationById(userId, id)
  }

  @Patch('notifications/:id/status')
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

  @Get('baseline/latest')
  getLatestBaseline(@Req() req: Request) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.getLatestBaseline(userId)
  }

  @Get(':id')
  findOne(@Req() req: Request, @Param('id') id: string) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.findOne(userId, id)
  }

  @Patch('alerts/:id/acknowledge')
  acknowledgeAlert(@Req() req: Request, @Param('id') id: string) {
    const { id: userId } = req.user as { id: string }
    return this.dailyJournalService.acknowledgeAlert(userId, id)
  }
}
