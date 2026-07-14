import {
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
import { ReportsService, type ReportsActor } from './reports.service.js'

type AuthedReq = Request & {
  user: { id: string; email: string | null; roles: UserRole[] }
}

/**
 * Monthly Practice Analytics Report endpoints. Mounted under the admin
 * namespace alongside `admin/users`, `admin/practices`, etc.
 *
 *   GET /api/admin/reports/practices      — practices the caller can pick
 *                                           from (MED_DIR scoped, OPS/SUPER
 *                                           see all)
 *   GET /api/admin/reports/monthly        — JSON payload (cached when past)
 *   GET /api/admin/reports/monthly.csv    — same data, CSV download
 *   GET /api/admin/reports/monthly.pdf    — printable PDF (compliance /
 *                                           grant archive)
 *
 * The controller-level @Roles gate covers the coarse "can read reports
 * at all" check; per-practice scope is enforced in
 * ReportsService.assertCanRead so MED_DIR can't peek at another practice
 * even with a forged practiceId param.
 */
@Controller('admin/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HEALPLACE_OPS, UserRole.MEDICAL_DIRECTOR)
export class ReportsController {
  constructor(
    private readonly service: ReportsService,
    private readonly prisma: PrismaService,
  ) {}

  private actorFrom(req: AuthedReq): ReportsActor {
    return {
      id: req.user.id,
      email: req.user.email,
      roles: req.user.roles,
    }
  }

  @Get('practices')
  async accessiblePractices(@Req() req: AuthedReq) {
    const list = await this.service.listAccessiblePractices(this.actorFrom(req))
    return {
      statusCode: 200,
      message: 'Practices retrieved',
      data: list,
    }
  }

  @Get('monthly')
  async monthly(
    @Req() req: AuthedReq,
    @Query() query: MonthlyReportQuery,
  ) {
    const caller = this.actorFrom(req)
    const practiceId = await this.resolvePracticeId(caller, query.practiceId)
    const data = await this.service.getMonthly({
      caller,
      practiceId,
      monthYear: query.month,
      fresh: query.fresh === '1' || query.fresh === 'true',
    })
    await this.logRead(caller, data.practiceId, data.monthYear, data.cached)
    return {
      statusCode: 200,
      message: 'Report retrieved',
      data,
    }
  }

  @Get('monthly.csv')
  async monthlyCsv(
    @Req() req: AuthedReq,
    @Query() query: MonthlyReportQuery,
    @Res() res: Response,
  ) {
    const caller = this.actorFrom(req)
    const practiceId = await this.resolvePracticeId(caller, query.practiceId)
    const report = await this.service.getMonthly({
      caller,
      practiceId,
      monthYear: query.month,
      fresh: query.fresh === '1' || query.fresh === 'true',
    })
    await this.logRead(caller, report.practiceId, report.monthYear, report.cached)

    const csv = '﻿' + this.service.toCsv(report) // BOM for Excel
    const safeName = report.practiceName.replace(/[^a-z0-9-_]+/gi, '_')
    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="cardioplace_${safeName}_${report.monthYear}.csv"`,
      )
      .send(csv)
  }

  @Get('monthly.pdf')
  async monthlyPdf(
    @Req() req: AuthedReq,
    @Query() query: MonthlyReportQuery,
    @Res() res: Response,
  ) {
    const caller = this.actorFrom(req)
    const practiceId = await this.resolvePracticeId(caller, query.practiceId)
    const report = await this.service.getMonthly({
      caller,
      practiceId,
      monthYear: query.month,
      fresh: query.fresh === '1' || query.fresh === 'true',
    })
    await this.logRead(caller, report.practiceId, report.monthYear, report.cached)

    const pdf = await this.service.toPdf(report)
    const safeName = report.practiceName.replace(/[^a-z0-9-_]+/gi, '_')
    res
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader('Content-Length', String(pdf.length))
      .setHeader(
        'Content-Disposition',
        `attachment; filename="cardioplace_${safeName}_${report.monthYear}.pdf"`,
      )
      .send(pdf)
  }

  /**
   * Pick the practice for a report call. If the caller passed one, use it
   * (auth still enforced in the service). If they didn't, fall back to the
   * single practice they're scoped to — only well-defined when the caller
   * sees exactly one practice (typical MED_DIR). OPS/SUPER must pick.
   */
  private async resolvePracticeId(
    caller: ReportsActor,
    requested: string | undefined,
  ): Promise<string> {
    if (requested) return requested
    const list = await this.service.listAccessiblePractices(caller)
    if (list.length === 1) return list[0].id
    throw new (await import('@nestjs/common')).BadRequestException(
      'practiceId is required when more than one practice is accessible',
    )
  }

  /**
   * Audit every report read so Joint Commission can reconstruct who saw
   * which practice's numbers when. Swallows errors so a logging failure
   * never breaks the user-facing request.
   */
  private async logRead(
    caller: ReportsActor,
    practiceId: string,
    monthYear: string,
    cached: boolean,
  ): Promise<void> {
    try {
      await this.prisma.authLog.create({
        data: {
          event: 'monthly_report_read',
          userId: caller.id,
          identifier: caller.email,
          metadata: { practiceId, monthYear, cached },
          success: true,
        },
      })
    } catch {
      // intentional: audit failure must never break the read
    }
  }
}
