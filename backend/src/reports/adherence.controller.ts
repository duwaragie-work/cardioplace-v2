import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { RolesGuard } from '../auth/guards/roles.guard.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { UserRole } from '../generated/prisma/enums.js'
import { AdherenceReportQuery } from './dto/adherence-report.query.js'
import { AdherenceService } from './adherence.service.js'
import { ReportsService, type ReportsActor } from './reports.service.js'

type AuthedReq = Request & {
  user: { id: string; email: string | null; roles: UserRole[] }
}

/**
 * 90-day Medication Adherence Report (phase/25). Same admin namespace and
 * same role gate as the monthly report — oversight surface for MED_DIR /
 * OPS / SUPER. Per-practice scope is enforced inside the service
 * (reused from ReportsService.assertCanRead).
 *
 *   GET /api/admin/reports/adherence       — JSON payload
 *   GET /api/admin/reports/adherence.csv   — CSV download
 *   GET /api/admin/reports/adherence.pdf   — printable PDF
 */
@Controller('admin/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HEALPLACE_OPS, UserRole.MEDICAL_DIRECTOR)
export class AdherenceController {
  constructor(
    private readonly service: AdherenceService,
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
  ) {}

  private actorFrom(req: AuthedReq): ReportsActor {
    return { id: req.user.id, email: req.user.email, roles: req.user.roles }
  }

  @Get('adherence')
  async adherence(@Req() req: AuthedReq, @Query() query: AdherenceReportQuery) {
    const caller = this.actorFrom(req)
    const practiceId = await this.resolvePracticeId(caller, query.practiceId)
    const data = await this.service.getAdherence({
      caller,
      practiceId,
      days: query.days,
    })
    await this.logRead(caller, data.practiceId, data.windowDays)
    return { statusCode: 200, message: 'Adherence report retrieved', data }
  }

  @Get('adherence.csv')
  async adherenceCsv(
    @Req() req: AuthedReq,
    @Query() query: AdherenceReportQuery,
    @Res() res: Response,
  ) {
    const caller = this.actorFrom(req)
    const practiceId = await this.resolvePracticeId(caller, query.practiceId)
    const report = await this.service.getAdherence({
      caller,
      practiceId,
      days: query.days,
    })
    await this.logRead(caller, report.practiceId, report.windowDays)

    const csv = '﻿' + this.service.toCsv(report) // BOM for Excel
    const safeName = report.practiceName.replace(/[^a-z0-9-_]+/gi, '_')
    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="cardioplace_adherence_${safeName}_${report.windowDays}d.csv"`,
      )
      .send(csv)
  }

  @Get('adherence.pdf')
  async adherencePdf(
    @Req() req: AuthedReq,
    @Query() query: AdherenceReportQuery,
    @Res() res: Response,
  ) {
    const caller = this.actorFrom(req)
    const practiceId = await this.resolvePracticeId(caller, query.practiceId)
    const report = await this.service.getAdherence({
      caller,
      practiceId,
      days: query.days,
    })
    await this.logRead(caller, report.practiceId, report.windowDays)

    const pdf = await this.service.toPdf(report)
    const safeName = report.practiceName.replace(/[^a-z0-9-_]+/gi, '_')
    res
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader('Content-Length', String(pdf.length))
      .setHeader(
        'Content-Disposition',
        `attachment; filename="cardioplace_adherence_${safeName}_${report.windowDays}d.pdf"`,
      )
      .send(pdf)
  }

  /**
   * Pick the practice. Caller-supplied wins (auth still enforced in the
   * service). Otherwise fall back to the single practice they're scoped to;
   * OPS/SUPER with many must pick. Mirrors ReportsController.resolvePracticeId.
   */
  private async resolvePracticeId(
    caller: ReportsActor,
    requested: string | undefined,
  ): Promise<string> {
    if (requested) return requested
    const list = await this.reports.listAccessiblePractices(caller)
    if (list.length === 1) return list[0].id
    throw new BadRequestException(
      'practiceId is required when more than one practice is accessible',
    )
  }

  /** Audit every read, same as the monthly report. Never throws. */
  private async logRead(
    caller: ReportsActor,
    practiceId: string,
    windowDays: number,
  ): Promise<void> {
    try {
      await this.prisma.authLog.create({
        data: {
          event: 'adherence_report_read',
          userId: caller.id,
          identifier: caller.email,
          metadata: { practiceId, windowDays },
          success: true,
        },
      })
    } catch {
      // audit failure must never break the read
    }
  }
}
