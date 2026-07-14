import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ClsService } from 'nestjs-cls'
import { runAsCronActor } from '../common/cls/cron-actor.util.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { AuditExceptionWriter } from './audit-exception-report/audit-exception-writer.js'
import { ALL_DETECTORS } from './audit-exception-report/detectors/index.js'
import type { DetectorContext } from './audit-exception-report/detector.types.js'

const SCAN_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * N7 (2026-07-11) — automated audit exception-report cron.
 *
 * Runs at 03:00 America/New_York (Eastern Time) daily — chosen because the
 * Ward 7 & 8 DC pilot operates in ET, so 3 AM local is the deepest-quiet
 * hour and results are ready when ET ops staff arrive in the morning.
 * `America/New_York` (not raw "EST") is the IANA identifier — DST is
 * handled automatically, so the cron correctly fires at 3 AM local
 * year-round (7 or 8 AM UTC depending on the season).
 *
 * For each of the 6 registered detectors, scans the past 24h of audit
 * data and hands each candidate to the writer. Failures inside a single
 * detector are logged and never abort the whole run — one detector's bad
 * query cannot starve the others.
 *
 * HIPAA §164.308(a)(1)(ii)(D) Information System Activity Review.
 *
 * Lakshitha's L3 worklist reads the AuditException rows this produces.
 * The row shape is the contract; her side owns dispatch (WhatsApp,
 * dashboard digest, escalation) and the SecurityIncident model.
 */
@Injectable()
export class AuditExceptionReportService {
  private readonly logger = new Logger(AuditExceptionReportService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: AuditExceptionWriter,
    private readonly cls: ClsService,
  ) {}

  // 03:00 America/New_York daily — DST-aware via IANA timezone. See class
  // docstring for the rationale (ET pilot, results-before-morning-shift).
  @Cron('0 3 * * *', { timeZone: 'America/New_York' })
  async scheduledRun() {
    return runAsCronActor(this.cls, 'cron-audit-exception-report', async () => {
      const summary = await this.run()
      this.logger.log(
        `Audit exception scan complete: created=${summary.created} updated=${summary.updated} sticky=${summary.stickySkipped} failedDetectors=${summary.failedDetectors}`,
      )
    })
  }

  /**
   * Runs one scan cycle. Exposed (not private) so the dev test-control
   * endpoint or an ops trigger can fire the scan without waiting for
   * 03:00 ET.
   */
  async run(now: Date = new Date()): Promise<{
    created: number
    updated: number
    stickySkipped: number
    failedDetectors: number
  }> {
    const windowEnd = now
    const windowStart = new Date(now.getTime() - SCAN_WINDOW_MS)
    const ctx: DetectorContext = { prisma: this.prisma, now, windowStart, windowEnd }

    let created = 0
    let updated = 0
    let stickySkipped = 0
    let failedDetectors = 0

    for (const detector of ALL_DETECTORS) {
      try {
        const candidates = await detector.scan(ctx)
        for (const c of candidates) {
          try {
            const result = await this.writer.upsert({
              detectorId: detector.id,
              defaultSeverity: detector.defaultSeverity,
              candidate: c,
              windowStart,
              windowEnd,
            })
            if (result.outcome === 'created') created++
            else if (result.outcome === 'updated') updated++
            else stickySkipped++
          } catch (err) {
            // Single-candidate write failure — log and continue. The whole
            // run should still surface as much detection as possible.
            this.logger.error(
              `AuditException write failed for detector=${detector.id} subject=${c.subjectKey}`,
              err instanceof Error ? err.stack : String(err),
            )
          }
        }
      } catch (err) {
        failedDetectors++
        this.logger.error(
          `Detector "${detector.id}" scan failed`,
          err instanceof Error ? err.stack : String(err),
        )
      }
    }

    return { created, updated, stickySkipped, failedDetectors }
  }
}
