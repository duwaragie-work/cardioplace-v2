import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { ClsService } from 'nestjs-cls'
import { runAsCronActor } from '../common/cls/cron-actor.util.js'
import { EmailService } from '../email/email.service.js'
import { EMAIL_TEMPLATE_VERSION, monthlyReportEmailHtml } from '../email/email-templates.js'
import type { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  monthWindowInTz,
  previousMonthInTz,
  ReportsService,
} from './reports.service.js'

/**
 * Monthly Practice Analytics Report cron.
 *
 * Runs at 06:00 UTC on the 1st of every month. For each active practice:
 *   1. Computes the prior month's report (in the practice's timezone).
 *   2. Upserts the MonthlyReportSnapshot row so the dashboard read is O(1).
 *   3. Emails every MEDICAL_DIRECTOR of that practice a one-tile summary
 *      with a deep-link into the admin report page.
 *
 * Failures inside the per-practice loop are logged but never abort the
 * whole run — one practice's email or DB hiccup cannot starve the others.
 */
@Injectable()
export class MonthlyReportCron {
  private readonly logger = new Logger(MonthlyReportCron.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly cls: ClsService,
  ) {}

  @Cron('0 6 1 * *') // 06:00 UTC, day 1 of each month
  async scheduledRun() {
    return runAsCronActor(this.cls, 'cron-monthly-report', async () => {
      const count = await this.run()
      this.logger.log(`Monthly report cron complete: ${count} practices`)
    })
  }

  /**
   * Generate + email for every practice. Exposed (not private) so the
   * dev test-control endpoint can trigger it without waiting for the
   * 1st of the month.
   */
  async run(now: Date = new Date()): Promise<number> {
    const practices = await this.prisma.practice.findMany({
      select: { id: true, name: true, businessHoursTimezone: true },
    })

    let processed = 0
    for (const practice of practices) {
      try {
        await this.runOne(practice, now)
        processed += 1
      } catch (err) {
        this.logger.error(
          `Monthly report failed for practice ${practice.id}`,
          err instanceof Error ? err.stack : String(err),
        )
      }
    }
    return processed
  }

  private async runOne(
    practice: { id: string; name: string; businessHoursTimezone: string },
    now: Date,
  ): Promise<void> {
    const monthYear = previousMonthInTz(now, practice.businessHoursTimezone)
    const { start, end } = monthWindowInTz(
      monthYear,
      practice.businessHoursTimezone,
    )

    const report = await this.reports.compute(practice, monthYear, start, end)

    await this.prisma.monthlyReportSnapshot.upsert({
      where: {
        practiceId_monthYear: { practiceId: practice.id, monthYear },
      },
      create: {
        practiceId: practice.id,
        monthYear,
        payload: report as unknown as Prisma.InputJsonValue,
      },
      update: {
        payload: report as unknown as Prisma.InputJsonValue,
        generatedAt: new Date(),
      },
    })

    // Email the practice's medical directors. Coordinators / providers
    // are intentionally skipped — the report is an oversight document.
    const recipients = await this.prisma.practiceMedicalDirector.findMany({
      where: { practiceId: practice.id },
      select: { user: { select: { name: true, email: true } } },
    })

    if (recipients.length === 0) {
      this.logger.warn(
        `Practice ${practice.id} (${practice.name}) has no medical director — skipping report email`,
      )
      return
    }

    const adminBaseUrl = this.config.get<string>(
      'ADMIN_BASE_URL',
      'http://localhost:3001',
    )
    const reportUrl = `${adminBaseUrl}/reports?practiceId=${practice.id}&month=${monthYear}`
    const monthLabel = formatMonthLabel(monthYear)

    for (const r of recipients) {
      const to = r.user.email
      if (!to) continue
      try {
        await this.email.sendEmail(
          to,
          `${practice.name} — Monthly alert report (${monthLabel})`,
          monthlyReportEmailHtml({
            recipientName: r.user.name ?? 'there',
            practiceName: practice.name,
            monthLabel,
            totalAlerts: report.overall.totalAlerts,
            ackInWindowPct: report.overall.acknowledgedInWindowPct,
            escalatedPct: report.overall.escalatedPct,
            meanResolveSeconds: report.overall.meanResolveSeconds,
            reportUrl,
          }),
          {
            // N6 — practice-wide aggregate report to a provider. Subject is the
            // practice, not a single patient; patientUserId stays null.
            template: 'monthly_report',
            templateVersion: EMAIL_TEMPLATE_VERSION,
            patientUserId: null,
            metadata: { practiceId: practice.id, monthYear },
          },
        )
      } catch (err) {
        this.logger.error(
          `Failed to email monthly report to ${to}`,
          err instanceof Error ? err.stack : String(err),
        )
      }
    }
  }
}

function formatMonthLabel(monthYear: string): string {
  // monthYear is `YYYY-MM`. Render as "May 2026" using UTC so it doesn't
  // shift across the dev host's local timezone.
  const [yStr, mStr] = monthYear.split('-')
  const d = new Date(Date.UTC(Number(yStr), Number(mStr) - 1, 1))
  return d.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
