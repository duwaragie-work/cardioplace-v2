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
import { MonthlyReportQuery } from './dto/monthly-report.query.js'
import { CohortService } from './cohort.service.js'
import { ReportsService, type ReportsActor } from './reports.service.js'

type AuthedReq = Request & {
  user: { id: string; email: string | null; roles: UserRole[] }
}

/**
 * Per-Condition Cohort Report (Task 4). Month-based, same admin namespace +
 * role gate as the other reports. Reuses MonthlyReportQuery. Per-practice
 * scope enforced in the service.
 *
 *   GET /api/admin/reports/cohorts       — JSON payload
 *   GET /api/admin/reports/cohorts.csv   — CSV download
 *   GET /api/admin/reports/cohorts.pdf   — printable PDF
 */
@Controller('admin/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HEALPLACE_OPS, UserRole.MEDICAL_DIRECTOR)
export class CohortController {
  constructor(
    private readonly service: CohortService,
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
  ) {}

  private actorFrom(req: AuthedReq): ReportsActor {
    return { id: req.user.id, email: req.user.email, roles: req.user.roles }
  }

  @Get('cohorts')
  async cohorts(@Req() req: AuthedReq, @Query() query: MonthlyReportQuery) {
    const caller = this.actorFrom(req)
    const practiceId = await this.resolvePracticeId(caller, query.practiceId)
    const data = await this.service.getCohorts({
      caller,
      practiceId,
      monthYear: query.month,
    })
    await this.logRead(caller, data.practiceId, data.monthYear)
    return { statusCode: 200, message: 'Cohort report retrieved', data }
  }

  @Get('cohorts.csv')
  async cohortsCsv(
    @Req() req: AuthedReq,
    @Query() query: MonthlyReportQuery,
    @Res() res: Response,
  ) {
    const caller = this.actorFrom(req)
    const practiceId = await this.resolvePracticeId(caller, query.practiceId)
    const report = await this.service.getCohorts({
      caller,
      practiceId,
      monthYear: query.month,
    })
    await this.logRead(caller, report.practiceId, report.monthYear)

    const csv = '﻿' + this.service.toCsv(report)
    const safeName = report.practiceName.replace(/[^a-z0-9-_]+/gi, '_')
    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="cardioplace_cohorts_${safeName}_${report.monthYear}.csv"`,
      )
      .send(csv)
  }

  @Get('cohorts.pdf')
  async cohortsPdf(
    @Req() req: AuthedReq,
    @Query() query: MonthlyReportQuery,
    @Res() res: Response,
  ) {
    const caller = this.actorFrom(req)
    const practiceId = await this.resolvePracticeId(caller, query.practiceId)
    const report = await this.service.getCohorts({
      caller,
      practiceId,
      monthYear: query.month,
    })
    await this.logRead(caller, report.practiceId, report.monthYear)

    const pdf = await this.service.toPdf(report)
    const safeName = report.practiceName.replace(/[^a-z0-9-_]+/gi, '_')
    res
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader('Content-Length', String(pdf.length))
      .setHeader(
        'Content-Disposition',
        `attachment; filename="cardioplace_cohorts_${safeName}_${report.monthYear}.pdf"`,
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
    monthYear: string,
  ): Promise<void> {
    try {
      await this.prisma.authLog.create({
        data: {
          event: 'cohort_report_read',
          userId: caller.id,
          identifier: caller.email,
          metadata: { practiceId, monthYear },
          success: true,
        },
      })
    } catch {
      // audit failure must never break the read
    }
  }
}
