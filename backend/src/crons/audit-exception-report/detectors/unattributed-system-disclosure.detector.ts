import {
  AuditExceptionDetectorId,
  AuditExceptionSeverity,
} from '../../../generated/prisma/enums.js'
import type {
  DetectorContext,
  ExceptionCandidate,
  ExceptionDetector,
} from '../detector.types.js'

/**
 * N7 detector — UNATTRIBUTED_SYSTEM_DISCLOSURE.
 *
 * Fires on any `EmailDisclosureLog` row where a SYSTEM_ACTOR send resolved
 * to the fallback principal `system-principal-unknown`. That fallback is N6's
 * belt-and-suspenders when a send fires outside any CLS context (boot-time
 * scripts, ad-hoc tooling) — a labelled unknown row is more useful than
 * crashing the send, but every one should be reviewed so the source path
 * gets attribution added.
 *
 * MEDIUM severity — not a security incident, but hygiene work.
 * Fires ≥1 row in window; one candidate per unique sending SURFACE
 * (template) so ten drops from the same misconfigured cron collapse to one.
 */
export class UnattributedSystemDisclosureDetector implements ExceptionDetector {
  readonly id = AuditExceptionDetectorId.UNATTRIBUTED_SYSTEM_DISCLOSURE
  readonly defaultSeverity = AuditExceptionSeverity.MEDIUM

  async scan(ctx: DetectorContext): Promise<ExceptionCandidate[]> {
    const rows = await ctx.prisma.emailDisclosureLog.findMany({
      where: {
        senderType: 'SYSTEM_ACTOR',
        senderPrincipal: 'system-principal-unknown',
        sentAt: { gte: ctx.windowStart, lt: ctx.windowEnd },
      },
      select: {
        id: true,
        template: true,
        patientUserId: true,
        recipientEmail: true,
        sentAt: true,
        subject: true,
      },
      orderBy: { sentAt: 'asc' },
    })
    if (rows.length === 0) return []

    // Group by template so a single mis-attributed source path becomes
    // one exception, not N.
    const byTemplate = new Map<string, typeof rows>()
    for (const r of rows) {
      const bucket = byTemplate.get(r.template) ?? []
      bucket.push(r)
      byTemplate.set(r.template, bucket)
    }

    const out: ExceptionCandidate[] = []
    for (const [template, group] of byTemplate) {
      // Sample the first + last row IDs for evidence — the reviewer can
      // pull the full set with a follow-up query. Full IDs list would
      // blow up on a large outage.
      const sample = group.slice(0, 5).map((r) => ({
        id: r.id,
        patientUserId: r.patientUserId,
        recipientEmail: r.recipientEmail,
        subject: r.subject,
        sentAt: r.sentAt.toISOString(),
      }))
      out.push({
        subjectKey: `template:${template}`,
        summary: `${group.length} unattributed SYSTEM_ACTOR email disclosure(s) for template "${template}"`,
        evidence: {
          template,
          totalCount: group.length,
          sample,
          firstSentAt: group[0].sentAt.toISOString(),
          lastSentAt: group[group.length - 1].sentAt.toISOString(),
        },
        practiceContext: null,
      })
    }
    return out
  }
}
