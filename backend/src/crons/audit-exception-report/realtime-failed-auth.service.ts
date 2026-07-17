import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OnEvent } from '@nestjs/event-emitter'
import { ClsService } from 'nestjs-cls'
import { runAsCronActor } from '../../common/cls/cron-actor.util.js'
import { getSystemPrincipalId } from '../../common/cls/system-principals.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { EmailService } from '../../email/email.service.js'
import {
  EMAIL_TEMPLATE_VERSION,
  securityAlertHtml,
} from '../../email/email-templates.js'
import {
  AuditExceptionDetectorId,
  AuditExceptionSeverity,
  NotificationChannel,
  SecurityIncidentActionType,
  SecurityIncidentSeverity,
  UserRole,
} from '../../generated/prisma/enums.js'
import { AUTH_EVENTS, type AuthFailureEvent } from '../../auth/auth.events.js'
import { AuditExceptionWriter } from './audit-exception-writer.js'
import type { ExceptionCandidate } from './detector.types.js'
import {
  aggregateFailedAuth,
  DEV_OTP_IDENTIFIER,
  FAILED_AUTH_SELECT,
} from './detectors/repeated-failed-auth.shared.js'

const LOOKBACK_MS = 24 * 60 * 60 * 1000

/**
 * Real-time counterpart to the 03:00 REPEATED_FAILED_AUTH batch detector.
 *
 * The batch catches a credential-stuffing burst up to ~24h late and only writes
 * an AuditException row — nothing pages a human. This service listens on
 * AUTH_EVENTS.FAILURE (emitted by auth-failure.extension.ts on every failed
 * AuthLog write) and, the moment one identifier crosses the threshold, raises
 * the SAME AuditException AND pages HEALPLACE_OPS (dashboard + browser push +
 * email). The 03:00 batch stays as the backstop.
 *
 * It reuses the batch detector's exact threshold + aggregation
 * (repeated-failed-auth.shared.ts) so the two paths can never drift.
 *
 * HIPAA §164.308(a)(6) Security Incident Procedures / §164.308(a)(5)(ii)(C)
 * Log-in Monitoring.
 */
@Injectable()
export class RealtimeFailedAuthService {
  private readonly logger = new Logger(RealtimeFailedAuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: AuditExceptionWriter,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly cls: ClsService,
  ) {}

  /**
   * `async: true` runs this off the auth write path and isolates throws — a
   * failure here can never affect sign-in. We also guard internally so a single
   * bad evaluation is logged, not surfaced.
   */
  @OnEvent(AUTH_EVENTS.FAILURE, { async: true })
  async onAuthFailure(event: AuthFailureEvent): Promise<void> {
    // Dev perma-OTP and null identifiers never page — same exclusion the batch
    // applies (centralised in the shared module).
    if (!event.identifier || event.identifier === DEV_OTP_IDENTIFIER) return

    try {
      // Reuse the cron principal so the AccessLog/Notification actor stamping
      // resolves to `audit-exception-report`, exactly like the batch run.
      await runAsCronActor(this.cls, 'cron-audit-exception-report', () =>
        this.evaluate(event.identifier as string, event.createdAt),
      )
    } catch (err) {
      this.logger.error(
        `Real-time failed-auth evaluation errored for identifier=${event.identifier}`,
        err instanceof Error ? err.stack : String(err),
      )
    }
  }

  private async evaluate(identifier: string, now: Date): Promise<void> {
    const rows = await this.prisma.authLog.findMany({
      where: {
        success: false,
        // `lte`, not `lt`: `now` IS the triggering row's own createdAt (the
        // extension emits AFTER the row persists), and that failure must be
        // counted — otherwise the count lags one behind and the exception
        // fires on the 6th failure instead of the 5th, missing the memo's
        // "N>=5 -> real-time exception" acceptance by one.
        createdAt: { gte: new Date(now.getTime() - LOOKBACK_MS), lte: now },
        identifier,
      },
      select: FAILED_AUTH_SELECT,
      orderBy: { createdAt: 'asc' },
    })

    // Same grouping/threshold as the batch. Scoped to one identifier, so this
    // yields 0 or 1 candidate.
    const [candidate] = aggregateFailedAuth(rows)
    if (!candidate) return

    // Idempotency: the writer keys on windowStart. Bucket to the top of the
    // current hour so a burst produces at most ONE real-time exception per
    // identifier per hour, instead of a fresh row on every failure past the 5th.
    // Known + accepted: the 03:00 batch computes a different (24h) windowStart
    // and may mint a second row for the same burst — the batch is the declared
    // backstop, and the writer sticky-skips RESOLVED / FALSE_POSITIVE rows.
    // Bucket in UTC (setUTCMinutes, not setMinutes) so the idempotency key is
    // independent of server timezone — a local-time floor would move the hour
    // boundary on any server not at UTC.
    const windowStart = new Date(now)
    windowStart.setUTCMinutes(0, 0, 0)

    const result = await this.writer.upsert({
      detectorId: AuditExceptionDetectorId.REPEATED_FAILED_AUTH,
      defaultSeverity: AuditExceptionSeverity.HIGH,
      candidate,
      windowStart,
      windowEnd: now,
    })

    // Reviewer already dispositioned this hour's row — do not re-page.
    if (result.outcome === 'sticky-skipped') return

    const evidence = candidate.evidence as {
      failedCount: number
      distinctIpCount: number
    }
    const isCritical =
      candidate.severityOverride === AuditExceptionSeverity.CRITICAL
    // Belt-and-suspenders: never let the page take down the write path.
    await this.page(identifier, candidate, evidence, isCritical).catch((err) =>
      this.logger.error(
        `Real-time failed-auth page failed for identifier=${identifier}`,
        err instanceof Error ? err.stack : String(err),
      ),
    )
  }

  /** Dashboard + browser push (to HEALPLACE_OPS) + email + a CRITICAL incident. */
  private async page(
    identifier: string,
    candidate: ExceptionCandidate,
    evidence: { failedCount: number; distinctIpCount: number },
    isCritical: boolean,
  ): Promise<void> {
    const severityLabel = isCritical ? 'CRITICAL' : 'HIGH'

    // 1. Dashboard bell + browser push, fanned to every HEALPLACE_OPS user.
    //    A PUSH-channel Notification is bell-visible (not EMAIL, not ALERT_*)
    //    AND triggers a browser push via push-dispatch.extension.ts; a
    //    per-user `create` (not createMany) is required for the push hook to
    //    fire. sentByActorId/Type are auto-stamped from the CLS actor.
    const opsUsers = await this.prisma.user.findMany({
      where: { roles: { has: UserRole.HEALPLACE_OPS } },
      select: { id: true },
    })
    for (const u of opsUsers) {
      await this.prisma.notification.create({
        data: {
          userId: u.id,
          channel: NotificationChannel.PUSH,
          title: `Security alert · ${severityLabel}`,
          body: `${evidence.failedCount} failed sign-ins for ${identifier} across ${evidence.distinctIpCount} IP(s)`,
          dispatchTrigger: 'SECURITY_EXCEPTION',
        },
      })
    }

    // 2. CRITICAL only — auto-open a SecurityIncident. A 5-failure fat-finger
    //    raises an exception + pages, but does not open a formal incident.
    if (isCritical) {
      await this.openIncident(identifier, candidate, evidence)
    }

    // 3. Email the security owner (if configured). Carries the auth IDENTIFIER
    //    + counts only — never patient data — so the disclosure's patientUserId
    //    is null (subject is a login, not a patient), mirroring contact_form /
    //    support_ops_notify.
    const to = this.config.get<string>('SECURITY_ALERT_EMAIL')?.trim()
    if (to) {
      const adminBase =
        this.config.get<string>('ADMIN_BASE_URL') ?? 'http://localhost:3001'
      await this.email.sendEmail(
        to,
        `[Security] ${severityLabel} — repeated failed auth for ${identifier}`,
        securityAlertHtml({
          identifier,
          failedCount: evidence.failedCount,
          distinctIpCount: evidence.distinctIpCount,
          severity: severityLabel,
          windowLabel: 'the last 24h',
          dashboardUrl: `${adminBase}/worklist`,
        }),
        {
          template: 'security_alert',
          templateVersion: EMAIL_TEMPLATE_VERSION,
          patientUserId: null,
          metadata: {
            identifier,
            failedCount: evidence.failedCount,
            distinctIpCount: evidence.distinctIpCount,
            severity: severityLabel,
          },
        },
      )
    }
  }

  /**
   * Auto-open a SecurityIncident under the `audit-exception-report` system
   * principal. openedByOpsId + SecurityIncidentAction.opsUserId are both
   * non-null, and the principal registry returns null if it is cold (boot warm
   * failed / seed not run). A cold registry MUST NOT cost us the page: log
   * loudly and skip only the incident.
   */
  private async openIncident(
    identifier: string,
    candidate: ExceptionCandidate,
    evidence: { failedCount: number; distinctIpCount: number },
  ): Promise<void> {
    const systemPrincipalId = getSystemPrincipalId('audit-exception-report')
    if (!systemPrincipalId) {
      this.logger.error(
        'SecurityIncident auto-open SKIPPED — audit-exception-report system ' +
          'principal is not warmed (seed missing or boot warm failed). The ops ' +
          'page still fired; open the incident manually from the worklist.',
      )
      return
    }

    await this.prisma.$transaction(async (tx) => {
      const incident = await tx.securityIncident.create({
        data: {
          status: 'OPEN',
          severity: SecurityIncidentSeverity.CRITICAL,
          title: `Sustained failed auth — ${identifier}`,
          summary: candidate.summary,
          sourceDetectorId: AuditExceptionDetectorId.REPEATED_FAILED_AUTH,
          practiceContext: candidate.practiceContext,
          openedByOpsId: systemPrincipalId,
          openedBySystem: true,
        },
        select: { id: true },
      })
      await tx.securityIncidentAction.create({
        data: {
          incidentId: incident.id,
          opsUserId: systemPrincipalId,
          actionType: SecurityIncidentActionType.OPENED,
          metadata: {
            autoOpened: true,
            identifier,
            failedCount: evidence.failedCount,
            distinctIpCount: evidence.distinctIpCount,
          },
        },
      })
    })
  }
}
