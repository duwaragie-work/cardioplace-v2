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
import { QuarterlyReportQuery } from './dto/quarterly-report.query.js'
import { QuarterlyService } from './quarterly.service.js'
import { ReportsService, type ReportsActor } from './reports.service.js'

type AuthedReq = Request & {
  user: { id: string; email: string | null; roles: UserRole[] }
}

/**
 * Quarterly Outcomes Report (Task 2). Same admin namespace and role gate as
 * the monthly + adherence reports. Per-practice scope enforced in the service.
 *
 *   GET /api/admin/reports/quarterly       — JSON payload
 *   GET /api/admin/reports/quarterly.csv   — CSV download
 *   GET /api/admin/reports/quarterly.pdf   — printable PDF
 */
@Controller('admin/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HEALPLACE_OPS, UserRole.MEDICAL_DIRECTOR)
export class QuarterlyController {
  constructor(
    private readonly service: QuarterlyService,
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
  ) {}

  private actorFrom(req: AuthedReq): ReportsActor {
    return { id: req.user.id, email: req.user.email, roles: req.user.roles }
  }

  @Get('quarterly')
  async quarterly(@Req() req: AuthedReq, @Query() query: QuarterlyReportQuery) {
    const caller = this.actorFrom(req)
    const practiceId = await this.resolvePracticeId(caller, query.practiceId)
    const data = await this.service.getQuarterly({
      caller,
      practiceId,
      quarter: query.quarter,
    })
    await this.logRead(caller, data.practiceId, data.quarter)
    return { statusCode: 200, message: 'Quarterly report retrieved', data }
  }

  @Get('quarterly.csv')
  async quarterlyCsv(
    @Req() req: AuthedReq,
    @Query() query: QuarterlyReportQuery,
    @Res() res: Response,
  ) {
    const caller = this.actorFrom(req)
    const practiceId = await this.resolvePracticeId(caller, query.practiceId)
    const report = await this.service.getQuarterly({
      caller,
      practiceId,
      quarter: query.quarter,
    })
    await this.logRead(caller, report.practiceId, report.quarter)

    const csv = '﻿' + this.service.toCsv(report)
    const safeName = report.practiceName.replace(/[^a-z0-9-_]+/gi, '_')
    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="cardioplace_quarterly_${safeName}_${report.quarter}.csv"`,
      )
      .send(csv)
  }

  @Get('quarterly.pdf')
  async quarterlyPdf(
    @Req() req: AuthedReq,
    @Query() query: QuarterlyReportQuery,
    @Res() res: Response,
  ) {
    const caller = this.actorFrom(req)
    const practiceId = await this.resolvePracticeId(caller, query.practiceId)
    const report = await this.service.getQuarterly({
      caller,
      practiceId,
      quarter: query.quarter,
    })
    await this.logRead(caller, report.practiceId, report.quarter)

    const pdf = await this.service.toPdf(report)
    const safeName = report.practiceName.replace(/[^a-z0-9-_]+/gi, '_')
    res
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader('Content-Length', String(pdf.length))
      .setHeader(
        'Content-Disposition',
        `attachment; filename="cardioplace_quarterly_${safeName}_${report.quarter}.pdf"`,
      )
      .send(pdf)
  }

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

  private async logRead(
    caller: ReportsActor,
    practiceId: string,
    quarter: string,
  ): Promise<void> {
    try {
      await this.prisma.authLog.create({
        data: {
          event: 'quarterly_report_read',
          userId: caller.id,
          identifier: caller.email,
          metadata: { practiceId, quarter },
          success: true,
        },
      })
    } catch {
      // audit failure must never break the read
    }
  }
}
