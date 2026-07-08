import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter'
import {
  EMERGENCY_EVENTS,
  type EmergencyFlaggedPayload,
} from '../../chat/emergency-events.js'
import { RULE_IDS } from '@cardioplace/shared'
import { Cron } from '@nestjs/schedule'
import { ClsService } from 'nestjs-cls'
import { runAsCronActor } from '../../common/cls/cron-actor.util.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { EmailService } from '../../email/email.service.js'
import { EMAIL_TEMPLATE_VERSION, caregiverEmailHtml } from '../../email/email-templates.js'
import { SmsService } from '../../sms/sms.service.js'
import { withDeadlockRetry } from '../../common/deadlock-retry.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import type {
  AlertCreatedEvent,
  EscalationDispatchedEvent,
} from '../interfaces/events.interface.js'
import {
  ladderForTier,
  nextStep,
  findStep,
  type LadderStep,
  type LadderStepId,
  type LadderKind,
  type RecipientRole,
  type NotificationChannel as LadderChannel,
  TIER_1_BACKUP_ON_T0,
  TIER_1_LADDER,
  // Manisha Open-Decisions sign-off 2026-06-06 (Decision 6) — BP_LEVEL_1_PATIENT_T0
  // re-instated, cohort-gated to STANDARD mode + HIGH tier only (HFrEF/HCM
  // suppressed to avoid alarm fatigue at tighter personalized thresholds).
  BP_LEVEL_1_PATIENT_T0,
  ANGIOEDEMA_PATIENT_T0,
  // Manisha Open-Decisions sign-off 2026-06-06 (Decision 5) — new patient-EMAIL
  // dispatch at T+0 to close the contraindication "continued exposure" gap.
  TIER_1_CONTRAINDICATION_PATIENT_T0,
} from '../escalation/ladder-defs.js'
import {
  isWithinBusinessHours,
  nextBusinessHoursStart,
  type BusinessHoursConfig,
} from '../utils/business-hours.js'
import { wasEverEnrolled } from '../../practice/enrollment-helpers.js'
import type { NotificationTrigger } from '../../generated/prisma/enums.js'

/**
 * Cluster 7 A.6 — rules whose primary delivery channel is the caregiver
 * dashboard rather than the standard provider escalation ladder. Each ruleId
 * here is Tier 3 (no ladder) and the alert's caregiverMessage is the payload.
 */
const CAREGIVER_ROUTED_RULES: ReadonlySet<string> = new Set<string>([
  'RULE_HF_CAREGIVER_EDEMA',
  // Cluster 8 — angioedema dispatches the approved caregiver message at T+0
  // (gated behind CAREGIVER_DISPATCH_ENABLED + the Gap 5 capture/consent loop).
  'RULE_ACE_ANGIOEDEMA',
  'RULE_GENERIC_ANGIOEDEMA',
])

/**
 * Phase/7 EscalationService — the single owner of the ladder state machine.
 *
 * Responsibilities:
 *  1. @OnEvent(ALERT_CREATED) — fire T+0 for escalatable tiers (TIER_1,
 *     BP_LEVEL_2, TIER_2). Tier 3 + BP Level 1 alerts pass through silently.
 *  2. @Cron — every 15 minutes advance overdue unacknowledged alerts to the
 *     next ladder step, and dispatch any EscalationEvent whose `scheduledFor`
 *     has passed (covers after-hours queueing + BP L2 #6 retries).
 *  3. scheduleRetry(...) — public hook for AlertResolutionService to create a
 *     BP Level 2 "unable to reach patient, will retry" fresh T+4h event.
 *
 * Each dispatch writes an EscalationEvent row + one Notification row per
 * (recipient, channel) combo (idempotent via @@unique in Notification).
 * `ESCALATION_DISPATCHED` fires after every successful dispatch so downstream
 * consumers (phase/19 analytics, future dashboards) can observe the ladder
 * without scraping DB rows.
 */
@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name)
  private readonly adminBaseUrl: string
  private readonly patientBaseUrl: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    config: ConfigService,
    private readonly cls: ClsService,
  ) {
    // Used by escalation emails to deep-link recipients into the right app.
    // Provider/admin recipients → admin app (/patients/{userId}?alert={id});
    // PATIENT recipients → patient app (/alerts/{id}). Defaults match the
    // local dev ports so emails are clickable even without env vars set.
    this.adminBaseUrl = config
      .get<string>('ADMIN_BASE_URL', 'http://localhost:3001')
      .replace(/\/+$/, '')
    this.patientBaseUrl = config
      .get<string>('PATIENT_BASE_URL', 'http://localhost:3000')
      .replace(/\/+$/, '')

    // 2026-06-07 user-flagged — a localhost URL leaked into an outbound email
    // would (a) be unclickable for recipients, (b) trigger spam-filter
    // mismatched-domain heuristics. Loud warning at boot if NODE_ENV is
    // production but the URLs still contain localhost — catches a missed
    // deploy-time env var without breaking local dev.
    const nodeEnv = config.get<string>('NODE_ENV', 'development')
    if (nodeEnv === 'production') {
      for (const [name, url] of [
        ['ADMIN_BASE_URL', this.adminBaseUrl],
        ['PATIENT_BASE_URL', this.patientBaseUrl],
      ] as const) {
        if (url.includes('localhost') || url.includes('127.0.0.1')) {
          this.logger.error(
            `${name} is set to "${url}" in production. Escalation emails will ` +
              `contain unclickable localhost links and will likely trip ` +
              `spam filters (domain-URL mismatch). Set this env var to the ` +
              `production domain (e.g. https://cardioplace.ai) before ` +
              `the next deploy.`,
          )
        }
        if (!url.startsWith('https://')) {
          this.logger.warn(
            `${name} is not https in production ("${url}"). Email recipients ` +
              `may see a mixed-content warning. Use https in production.`,
          )
        }
      }
    }
  }

  // ─── event + cron entry points ──────────────────────────────────────────

  @OnEvent(JOURNAL_EVENTS.ALERT_CREATED, { async: true })
  async handleAlertCreated(payload: AlertCreatedEvent, now: Date = new Date()): Promise<void> {
    try {
      await this.fireT0(payload, now)
    } catch (err) {
      this.logger.error(
        `T+0 dispatch failed for alert ${payload.alertId}`,
        err instanceof Error ? err.stack : err,
      )
    }
    // Cluster 7 A.6 — caregiver dispatch runs alongside the standard ladder.
    // Tier 3 caregiver-routed rules (e.g. RULE_HF_CAREGIVER_EDEMA) have no
    // ladder, so fireT0() exits early; this path is their only delivery.
    try {
      await this.dispatchCaregiverNotification(payload)
    } catch (err) {
      this.logger.error(
        `Caregiver dispatch failed for alert ${payload.alertId}`,
        err instanceof Error ? err.stack : err,
      )
    }
  }

  /**
   * Bug 11 — chat/voice `flag_emergency` tool fires an emergency.flagged event
   * after ChatService persists the EmergencyEvent row. This listener pages the
   * patient's consenting caregivers AND their assigned provider so the care
   * team learns about an acute emergency in real time, not via DB audit
   * scrape. Reuses findCaregivers + the SMS/email/DASHBOARD plumbing the
   * standard alert path uses.
   */
  @OnEvent(EMERGENCY_EVENTS.FLAGGED, { async: true })
  async onEmergencyFlagged(payload: EmergencyFlaggedPayload): Promise<void> {
    try {
      await this.dispatchEmergencyToCareTeam(payload)
    } catch (err) {
      this.logger.error(
        `[SECURITY-CRITICAL] Emergency dispatch failed userId=${payload.userId} situation="${payload.situation}"`,
        err instanceof Error ? err.stack : err,
      )
    }
  }

  private async dispatchEmergencyToCareTeam(
    payload: EmergencyFlaggedPayload,
  ): Promise<void> {
    const subject = `URGENT — Cardioplace patient emergency`
    const body =
      `A Cardioplace patient flagged an acute emergency during a ${
        payload.source === 'voice-tool' ? 'voice' : 'chat'
      } session.\n\n` +
      `Situation reported by the patient: ${payload.situation}\n\n` +
      `Please reach out to the patient immediately or escalate per your practice's emergency protocol. ` +
      `An EmergencyEvent has been recorded in the audit log.`

    // 1) Consenting caregivers — same dispatch pattern as L1 alerts.
    const caregivers = await this.findCaregivers(payload.userId)
    for (const caregiver of caregivers) {
      try {
        switch (caregiver.notifyChannel) {
          case 'EMAIL':
            if (caregiver.email) {
              await this.emailService.sendEmail(caregiver.email, subject, body, {
                template: 'emergency_dispatch_caregiver',
                templateVersion: EMAIL_TEMPLATE_VERSION,
                patientUserId: payload.userId,
                metadata: { caregiverId: caregiver.id },
              })
            }
            break
          case 'SMS':
            if (caregiver.phone) {
              await this.smsService.sendSms(caregiver.phone, body)
            }
            break
          case 'DASHBOARD':
            if (caregiver.caregiverUserId) {
              await this.prisma.notification.create({
                data: {
                  userId: caregiver.caregiverUserId,
                  patientUserId: payload.userId,
                  channel: 'DASHBOARD',
                  title: subject,
                  body,
                  // EMERGENCY_FLAGGED, not ALERT_*: this chat/voice emergency
                  // page has no DeviationAlert backing (EmergencyEvent only), so
                  // it never appears in the Alerts stream — it MUST stay visible
                  // in the care team's bell. See project_notification_tab_split.
                  dispatchTrigger: 'EMERGENCY_FLAGGED',
                },
              })
            }
            break
          default:
            break
        }
      } catch (err) {
        this.logger.error(
          `Emergency dispatch to caregiver ${caregiver.id} failed`,
          err instanceof Error ? err.stack : err,
        )
      }
    }

    // 2) Assigned providers — DASHBOARD notification to the primary AND
    // backup so the emergency lands in someone's inbox without depending on
    // SMS/email config. PatientProviderAssignment uses `userId` (the
    // patient) as the unique key, and stores `primaryProviderId` +
    // `backupProviderId`.
    const assignment = await this.prisma.patientProviderAssignment.findUnique({
      where: { userId: payload.userId },
      select: { primaryProviderId: true, backupProviderId: true },
    })
    const providerIds = new Set<string>()
    if (assignment?.primaryProviderId) providerIds.add(assignment.primaryProviderId)
    if (assignment?.backupProviderId) providerIds.add(assignment.backupProviderId)
    for (const providerId of providerIds) {
      try {
        await this.prisma.notification.create({
          data: {
            userId: providerId,
            patientUserId: payload.userId,
            channel: 'DASHBOARD',
            title: subject,
            body,
            // EMERGENCY_FLAGGED, not ALERT_*: no DeviationAlert backing, so this
            // must stay visible in the provider's bell (not hidden as alert-class).
            dispatchTrigger: 'EMERGENCY_FLAGGED',
          },
        })
      } catch (err) {
        this.logger.error(
          `Emergency notification to provider ${providerId} failed`,
          err instanceof Error ? err.stack : err,
        )
      }
    }

    this.logger.log(
      `Emergency dispatched userId=${payload.userId} caregivers=${caregivers.length} providers=${providerIds.size} source=${payload.source}`,
    )
  }

  @Cron('*/15 * * * *')
  async handleCron(): Promise<void> {
    return runAsCronActor(this.cls, 'cron-escalation-ladder', () =>
      this.handleCronImpl(),
    )
  }

  private async handleCronImpl(): Promise<void> {
    // Managed Prisma Postgres occasionally hands the pool a stale connection
    // (server hung up while idle) — first query throws "Server has closed
    // the connection" / P1017. node-postgres evicts the bad socket on that
    // error, so an immediate retry picks up a healthy connection. One-shot
    // retry only — anything beyond that is a real outage and should surface.
    try {
      await this.runScan(new Date())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const isStaleConnection =
        message.includes('Server has closed the connection') ||
        message.includes('P1017') ||
        message.includes('Connection terminated')
      if (isStaleConnection) {
        this.logger.warn('Escalation cron — stale connection, retrying once')
        try {
          await this.runScan(new Date())
          return
        } catch (retryErr) {
          this.logger.error(
            'Escalation cron scan failed after retry',
            retryErr instanceof Error ? retryErr.stack : retryErr,
          )
          return
        }
      }
      this.logger.error(
        'Escalation cron scan failed',
        err instanceof Error ? err.stack : err,
      )
    }
  }

  /** Public sync entry for tests + ops tooling. */
  async runScan(now: Date): Promise<void> {
    await this.firePendingScheduled(now)
    await this.advanceOverdueLadders(now)
  }

  /**
   * Test-only deterministic T+0 driver. In production, T+0 fires via the
   * fire-and-forget `@OnEvent(ALERT_CREATED)` handler — a Playwright spec
   * can't await that, and `runScan` does NOT fire a fresh alert's T+0 (it
   * only does firePendingScheduled + advanceOverdueLadders). This reconstructs
   * the AlertCreatedEvent from the persisted alert and awaits the SAME private
   * `fireT0` path, so the T+0 Notification rows are guaranteed written before
   * the caller continues. Idempotent — the dispatchStep dedup guard makes a
   * second fire (or a race with the async handler) a safe no-op. Errors
   * propagate, unlike the @OnEvent wrapper which swallows them, so a real
   * dispatch failure surfaces to the test instead of vanishing into the log.
   */
  async dispatchT0ForAlert(alertId: string, now: Date = new Date()): Promise<void> {
    const alert = await this.loadAlert(alertId)
    if (!alert) throw new NotFoundException(`Alert ${alertId} not found`)
    // fireT0 routes solely on alertId + tier; type/severity/escalated are not
    // read on the dispatch path (the ladder is resolved from tier), so the
    // narrowed AlertRow — which omits them — is sufficient. Placeholders keep
    // the AlertCreatedEvent shape without re-fetching the full row.
    await this.fireT0(
      {
        userId: alert.userId,
        alertId: alert.id,
        type: 'SYSTOLIC_BP',
        severity: 'HIGH',
        escalated: true,
        tier: alert.tier,
        ruleId: alert.ruleId,
      },
      now,
    )
  }

  /**
   * Called by AlertResolutionService when an admin picks BP L2 #6
   * `BP_L2_UNABLE_TO_REACH_RETRY`. Creates a fresh EscalationEvent with
   * scheduledFor=now+offsetMs; the next cron pass dispatches it via
   * `firePendingScheduled`.
   */
  async scheduleRetry(args: {
    alertId: string
    userId: string
    ladderStep: LadderStepId
    offsetMs: number
    recipientRoles: RecipientRole[]
    channels: LadderChannel[]
    now: Date
    /** Override the audit reason. Defaults to the BP L2 retry text. */
    reason?: string
    /** Override the escalation level. Defaults to LEVEL_2. */
    escalationLevel?: 'LEVEL_1' | 'LEVEL_2'
  }): Promise<void> {
    const scheduledFor = new Date(args.now.getTime() + args.offsetMs)
    await this.prisma.escalationEvent.create({
      data: {
        alertId: args.alertId,
        userId: args.userId,
        escalationLevel: args.escalationLevel ?? 'LEVEL_2',
        reason:
          args.reason ??
          `BP L2 retry — ${args.ladderStep} scheduled ${scheduledFor.toISOString()}`,
        ladderStep: args.ladderStep,
        recipientIds: [],
        recipientRoles: args.recipientRoles,
        scheduledFor,
        triggeredByResolution: true,
        // Finding 5 — scheduled by an admin resolution action, not the cron
        // scheduler. Human-attributed.
        dispatchedBySystem: false,
        afterHours: false,
      },
    })
    this.logger.log(
      `Scheduled retry for alert ${args.alertId} at ${scheduledFor.toISOString()}`,
    )
  }

  // ─── catch-up: dispatch alerts deferred while patient was un-enrolled ──
  //
  // CLINICAL_SPEC V2-D enrollment gate — when a patient isn't enrolled at
  // the moment an alert fires, fireT0 returns early (line ~156) and writes
  // no EscalationEvent. The DeviationAlert row stays visible to admins but
  // the ladder never starts. Without a catch-up, those alerts stay
  // un-escalated forever even after enrollment completes.
  //
  // EnrollmentService.completeEnrollment calls this immediately after
  // flipping a patient to ENROLLED. We re-fire T+0 for any open alert with
  // zero EscalationEvents, capped to the last 7 days so a long-deferred
  // patient doesn't trigger a flood of stale notifications on enrollment
  // day. Alerts older than 7 days stay visible in the dashboard but never
  // escalate — admins can resolve them manually.
  async dispatchDeferredForUser(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ dispatched: number; skipped: number }> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const alerts = await this.prisma.deviationAlert.findMany({
      where: {
        userId,
        status: 'OPEN',
        createdAt: { gte: sevenDaysAgo },
        // The signature of "deferred at T+0" — DeviationAlert exists but no
        // EscalationEvent was ever written. Alerts that dispatched normally
        // have at least the T+0 row, so they're filtered out here.
        escalationEvents: { none: {} },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        userId: true,
        type: true,
        severity: true,
        escalated: true,
        tier: true,
        ruleId: true,
      },
    })

    if (alerts.length === 0) return { dispatched: 0, skipped: 0 }

    this.logger.log(
      `Catch-up dispatch for user ${userId}: ${alerts.length} deferred alert(s) within 7d`,
    )

    let dispatched = 0
    let skipped = 0
    for (const a of alerts) {
      // Tier 3 / unknown tiers have no ladder — fireT0 will log + return,
      // count those as skipped here so the caller's metrics are honest.
      if (!ladderForTier(a.tier)) {
        skipped++
        continue
      }
      try {
        await this.fireT0(
          {
            alertId: a.id,
            userId: a.userId,
            type: a.type ?? '',
            severity: a.severity ?? '',
            escalated: a.escalated,
            tier: a.tier,
            ruleId: a.ruleId,
          },
          now,
        )
        dispatched++
      } catch (err) {
        this.logger.error(
          `Catch-up T+0 failed for alert ${a.id}`,
          err instanceof Error ? err.stack : err,
        )
        skipped++
      }
    }
    return { dispatched, skipped }
  }

  // ─── T+0 on alert creation ──────────────────────────────────────────────

  private async fireT0(payload: AlertCreatedEvent, now: Date): Promise<void> {
    const ladder = ladderForTier(payload.tier)
    if (!ladder) {
      this.logger.debug(
        `Alert ${payload.alertId} tier=${payload.tier} — not escalatable, skipping`,
      )
      return
    }

    const alert = await this.loadAlert(payload.alertId)
    if (!alert) {
      this.logger.warn(`Alert ${payload.alertId} not found — skipping T+0`)
      return
    }

    // Layer B dispatch gate — the DeviationAlert row is preserved (admin can
    // see it on the dashboard once the patient is enrolled), but we do not
    // notify anyone until the 4-piece enrollment gate has been passed.
    // Without assignment we'd have no PRIMARY/BACKUP/MD to resolve, and the
    // fail-loud path would just write DISPATCH ERROR rows. See
    // TESTING_FLOW_GUIDE.md §6.2–§6.3.
    if (alert.user.enrollmentStatus !== 'ENROLLED') {
      // Manisha sign-off 2026-06-12 — a patient who was EVER enrolled keeps
      // their full dispatch + ladder after an auto-un-enroll (serious condition
      // added without a threshold). Care team + routing are already in place;
      // only the personalized threshold is pending. A truly never-enrolled
      // patient still defers (original gate intent). See enrollment-gate-
      // emergency-gap memory note.
      const previouslyEnrolled = await wasEverEnrolled(this.prisma, alert.userId)
      if (!previouslyEnrolled) {
        this.logger.log(
          `Alert ${alert.id}: patient ${alert.userId} never enrolled — deferring dispatch at T+0`,
        )
        return
      }
      this.logger.log(
        `Alert ${alert.id}: patient ${alert.userId} un-enrolled (threshold pending) — dispatching anyway (previously enrolled, at T+0)`,
      )
      // fall through to normal T+0 dispatch
    }

    const practice = alert.user.providerAssignmentAsPatient?.practice ?? null
    const assignment = alert.user.providerAssignmentAsPatient ?? null

    const firstStep = ladder.steps[0]
    if (!firstStep) return

    // Normal T+0 dispatch (respects after-hours per step config).
    await this.dispatchStep({
      alert,
      step: firstStep,
      ladderKind: ladder.kind,
      recipientRoles: firstStep.recipientRoles,
      practice,
      assignment,
      now,
    })

    // Tier 1 after-hours safety net: fire BACKUP immediately so someone is
    // paged while PRIMARY is queued to next business hours. During business
    // hours the PRIMARY fires at T+0 anyway, so BACKUP's proper entry point
    // is the T+4h step — no courtesy fire needed.
    //
    // CLINICAL_SPEC §V2-D After-Hours handling: "Tier 1: Queue for first
    // business day. Immediate push to backup. Escalation clock starts next
    // business day." The "immediate push to backup" scopes to after-hours.
    //
    // Cluster 8 — angioedema is excluded: its ladder is FIRE_IMMEDIATELY
    // (primary always pages at T+0 regardless of hours) and it has an
    // explicit T+15m backup step, so the after-hours courtesy backup would
    // double-page. The "primary is queued" rationale doesn't apply.
    if (
      ladder.kind === 'TIER_1' &&
      alert.tier !== 'TIER_1_ANGIOEDEMA' &&
      practice != null
    ) {
      const afterHours = !isWithinBusinessHours(now, practice)
      if (afterHours) {
        await this.dispatchStep({
          alert,
          step: { ...firstStep, afterHoursBehavior: 'FIRE_IMMEDIATELY' },
          ladderKind: ladder.kind,
          recipientRoles: TIER_1_BACKUP_ON_T0,
          practice,
          assignment,
          now,
        })
      }
    }

    // Manisha Open-Decisions sign-off 2026-06-06 (Decision 6) — re-instate
    // BP_LEVEL_1_PATIENT_T0 dispatch, COHORT-GATED.
    //
    // Original retirement (Manual-test round 2 Group B) blanket-suppressed
    // every BP Level 1 patient-row dispatch. Manisha's clarification: standard-
    // cohort patients at 165/100 ARE experiencing a clinically meaningful
    // event (2025 AHA/ACC: SBP ≥140 = medication-initiation threshold for the
    // general population) and should learn about it without having to open
    // the app. Personalized-threshold cohorts (HFrEF, HCM) stay suppressed —
    // their tighter thresholds would generate more frequent patient alerts
    // and risk alarm fatigue in the very population they protect.
    //
    // Gate:
    //   - tier === 'BP_LEVEL_1_HIGH'  (HIGH only — Manisha did NOT sign off on LOW)
    //   - mode === 'STANDARD'         (engine sets PERSONALIZED for HFrEF/HCM ramps)
    //
    // Channel = EMAIL + DASHBOARD per the ladder-defs export (out-of-app
    // PUSH not yet wired; EMAIL is the real reach).
    if (alert.tier === 'BP_LEVEL_1_HIGH' && alert.mode === 'STANDARD') {
      await this.dispatchStep({
        alert,
        step: BP_LEVEL_1_PATIENT_T0,
        ladderKind: ladder.kind,
        recipientRoles: BP_LEVEL_1_PATIENT_T0.recipientRoles,
        practice,
        assignment,
        now,
      })
    }

    // Manisha Open-Decisions sign-off 2026-06-06 (Decision 5) — TIER_1
    // CONTRAINDICATION patient-EMAIL at T+0. Closes the gap where a patient
    // could take another dose of a teratogenic/contraindicated medication
    // before opening the app. Email body reuses the registry patientMessage
    // (already worded to discourage panic-driven self-discontinuation:
    // "please don't stop any medicine without talking to your doctor").
    // Option D (Manisha 2026-06-12 Q2) — RULE_UNCONFIRMED_EMERGENCY reuses the
    // TIER_1_CONTRAINDICATION ladder + resolution catalog, but is PROVIDER-ONLY
    // (Implementation Note 5: no patient, no caregiver — the reading is
    // unconfirmed and may be artifactual). Suppress the contraindication
    // patient-EMAIL dispatch for it; the provider ladder still fires.
    if (
      alert.tier === 'TIER_1_CONTRAINDICATION' &&
      alert.ruleId !== RULE_IDS.UNCONFIRMED_EMERGENCY
    ) {
      await this.dispatchStep({
        alert,
        step: TIER_1_CONTRAINDICATION_PATIENT_T0,
        ladderKind: ladder.kind,
        recipientRoles: TIER_1_CONTRAINDICATION_PATIENT_T0.recipientRoles,
        practice,
        assignment,
        now,
      })
    }

    // Cluster 8 — angioedema patient T+0. Out-of-app push + in-app card so
    // the patient sees the full-screen red + 911 CTA without opening the app
    // first. Fires immediately regardless of business hours (airway
    // emergency). Same separate-dispatch pattern as BP_LEVEL_1_PATIENT_T0.
    if (alert.tier === 'TIER_1_ANGIOEDEMA') {
      await this.dispatchStep({
        alert,
        step: ANGIOEDEMA_PATIENT_T0,
        ladderKind: ladder.kind,
        recipientRoles: ANGIOEDEMA_PATIENT_T0.recipientRoles,
        practice,
        assignment,
        now,
      })
    }
  }

  // ─── cron: dispatch scheduled events whose time has come ────────────────

  private async firePendingScheduled(now: Date): Promise<void> {
    const rows = await this.prisma.escalationEvent.findMany({
      where: {
        scheduledFor: { lte: now, not: null },
        notificationSentAt: null,
      },
    })
    for (const row of rows) {
      const alert = await this.loadAlert(row.alertId)
      if (!alert) continue

      // Layer B gate — patient un-enrolled between queue time and dispatch
      // time (e.g. admin revoked enrollment). Leave the row in place;
      // re-enrollment will pick it up on the next cron pass.
      if (alert.user.enrollmentStatus !== 'ENROLLED') {
        // Manisha sign-off 2026-06-12 — previously-enrolled patients dispatch
        // even while un-enrolled (threshold pending). See enrollment-gate-
        // emergency-gap memory note + fireT0 gate above.
        const previouslyEnrolled = await wasEverEnrolled(this.prisma, alert.userId)
        if (!previouslyEnrolled) {
          this.logger.debug(
            `Pending event ${row.id}: patient ${alert.userId} never enrolled — deferring at firePendingScheduled`,
          )
          continue
        }
        this.logger.log(
          `Pending event ${row.id}: patient ${alert.userId} un-enrolled (threshold pending) — dispatching anyway (previously enrolled, at firePendingScheduled)`,
        )
        // fall through — dispatch the queued/scheduled event
      }

      // Check alert still open + not acknowledged; if it's been resolved /
      // acknowledged since, skip and mark the event as sent (so we don't
      // re-scan it forever).
      //
      // EXCEPTION: events scheduled by a resolution decision (retry path —
      // BP_L2_UNABLE_TO_REACH_RETRY currently) MUST fire regardless of the
      // alert's ack state. The provider chose "unable to reach, try again
      // later" *after* acknowledging — the ack is part of the audit trail
      // ("I saw this and I tried"), not a signal to abandon the patient.
      // Without this exemption the retry gets silently dropped and a BP L2
      // emergency where the patient was unreachable receives no follow-up.
      // Tracked: cluster-2 / B4 in qa/reports/RESULTS.md (Dr. Singal sign-off
      // — Option 2: preserve ack for audit, retry fires anyway).
      if (
        !row.triggeredByResolution &&
        (alert.status !== 'OPEN' || alert.acknowledgedAt)
      ) {
        await this.prisma.escalationEvent.update({
          where: { id: row.id },
          data: { notificationSentAt: now, reason: 'skipped — alert resolved or acknowledged' },
        })
        continue
      }
      // For retry-triggered events on a fully RESOLVED alert (i.e. the
      // provider explicitly closed the alert with a different action AFTER
      // scheduling the retry), still skip — closure means patient was
      // reached. Only ACKNOWLEDGED state is exempted above.
      if (row.triggeredByResolution && alert.status === 'RESOLVED') {
        await this.prisma.escalationEvent.update({
          where: { id: row.id },
          data: { notificationSentAt: now, reason: 'skipped — alert resolved post-retry-schedule' },
        })
        continue
      }

      const ladder = ladderForTier(alert.tier)
      const step = ladder ? findStep(ladder.steps, row.ladderStep ?? 'T0') : null
      if (!ladder || !step) {
        await this.prisma.escalationEvent.update({
          where: { id: row.id },
          data: { notificationSentAt: now, reason: 'skipped — no ladder match' },
        })
        continue
      }

      const practice = alert.user.providerAssignmentAsPatient?.practice ?? null
      const assignment = alert.user.providerAssignmentAsPatient ?? null
      await this.dispatchForExistingEvent({
        eventId: row.id,
        alert,
        step,
        ladderKind: ladder.kind,
        recipientRoles: row.recipientRoles.length
          ? (row.recipientRoles as RecipientRole[])
          : step.recipientRoles,
        practice,
        assignment,
        now,
        triggeredByResolution: row.triggeredByResolution,
      })
    }
  }

  // ─── cron: advance ladder for overdue unacknowledged alerts ─────────────

  private async advanceOverdueLadders(now: Date): Promise<void> {
    const candidates = await this.prisma.deviationAlert.findMany({
      where: {
        status: 'OPEN',
        acknowledgedAt: null,
        tier: {
          in: [
            'TIER_1_CONTRAINDICATION',
            // Cluster 8 — without this the compressed angioedema ladder
            // never advances past T+0 (T+15m/T+1h/T+4h never fire).
            'TIER_1_ANGIOEDEMA',
            'TIER_2_DISCREPANCY',
            'BP_LEVEL_2',
            'BP_LEVEL_2_SYMPTOM_OVERRIDE',
          ],
        },
      },
      include: ALERT_INCLUDE,
    })

    for (const alert of candidates) {
      const ladder = ladderForTier(alert.tier)
      if (!ladder) continue

      // Layer B gate — skip advancing for un-enrolled patients. This also
      // catches alerts created pre-enrollment-split (when fireT0 didn't gate)
      // so their ladders don't keep walking once the filter kicks in.
      if (alert.user.enrollmentStatus !== 'ENROLLED') {
        // Manisha sign-off 2026-06-12 — previously-enrolled patients keep their
        // ladder advancing even while un-enrolled (threshold pending). See
        // enrollment-gate-emergency-gap memory note + fireT0 gate above.
        const previouslyEnrolled = await wasEverEnrolled(this.prisma, alert.userId)
        if (!previouslyEnrolled) {
          this.logger.debug(
            `Alert ${alert.id}: patient ${alert.userId} never enrolled — ladder paused at advanceOverdueLadders`,
          )
          continue
        }
        this.logger.log(
          `Alert ${alert.id}: patient ${alert.userId} un-enrolled (threshold pending) — advancing ladder anyway (previously enrolled, at advanceOverdueLadders)`,
        )
        // fall through — advance the ladder normally
      }

      // Fetch all escalation events for the alert — need both dispatched rows
      // (for "completed" step set) AND the primary T+0 row (for anchor, whether
      // dispatched or still queued).
      const events = await this.prisma.escalationEvent.findMany({
        where: { alertId: alert.id },
        orderBy: { triggeredAt: 'asc' },
        select: {
          ladderStep: true,
          recipientRoles: true,
          triggeredAt: true,
          scheduledFor: true,
          notificationSentAt: true,
        },
      })

      // Tier 1 T+0 has TWO rows: the ladder row (recipientRoles includes
      // PRIMARY_PROVIDER) and the courtesy backup row. Only the primary counts
      // as the ladder anchor; the backup is not on the main ladder. Other
      // tiers have a single T+0 row.
      const isCourtesyBackup = (e: {
        ladderStep: string | null
        recipientRoles: string[]
      }) =>
        ladder.kind === 'TIER_1' &&
        e.ladderStep === 'T0' &&
        !e.recipientRoles.includes('PRIMARY_PROVIDER')

      const completedIds = new Set(
        events
          .filter((e) => e.notificationSentAt != null && !isCourtesyBackup(e))
          .map((e) => e.ladderStep),
      )

      // Find the latest completed step's ladder index, or -1 if nothing fired.
      let latestIdx = -1
      ladder.steps.forEach((s, i) => {
        if (completedIds.has(s.step)) latestIdx = Math.max(latestIdx, i)
      })

      const upcoming = nextStep(
        ladder.steps,
        latestIdx >= 0 ? ladder.steps[latestIdx].step : null,
      )
      if (!upcoming) continue // ladder finished

      // Deadline anchor per CLINICAL_SPEC §V2-D "After-hours handling" — the
      // escalation clock starts when T+0 actually dispatched (not when the
      // alert was created). For BP L2 (immediate fire) and Tier 2 (queued at
      // T+0), this collapses to alert.createdAt in the happy path; for Tier 1
      // after-hours it correctly defers the whole ladder to next-business-open.
      const t0Primary = events.find(
        (e) =>
          e.ladderStep === 'T0' &&
          !isCourtesyBackup(e),
      )
      const anchor =
        t0Primary?.notificationSentAt ??
        t0Primary?.scheduledFor ??
        t0Primary?.triggeredAt ??
        alert.createdAt

      const deadline = new Date(anchor.getTime() + upcoming.offsetMs)
      if (now < deadline) continue

      const practice = alert.user.providerAssignmentAsPatient?.practice ?? null
      const assignment = alert.user.providerAssignmentAsPatient ?? null
      await this.dispatchStep({
        alert,
        step: upcoming,
        ladderKind: ladder.kind,
        recipientRoles: upcoming.recipientRoles,
        practice,
        assignment,
        now,
      })
    }
  }

  // ─── dispatch primitives ────────────────────────────────────────────────

  /**
   * Creates a fresh EscalationEvent and dispatches (or queues) per the step's
   * after-hours behavior. Called by fireT0 + advanceOverdueLadders.
   */
  private async dispatchStep(args: {
    alert: AlertRow
    step: LadderStep
    ladderKind: LadderKind
    recipientRoles: RecipientRole[]
    practice: BusinessHoursConfig | null
    assignment: AssignmentRow | null
    now: Date
  }): Promise<void> {
    const { alert, step, practice, assignment, now } = args
    const afterHours =
      practice != null && !isWithinBusinessHours(now, practice)
    const shouldQueue =
      afterHours &&
      step.afterHoursBehavior === 'QUEUE_UNTIL_BUSINESS_HOURS' &&
      practice != null

    const resolved = await this.getRecipientUserIds(
      assignment,
      args.recipientRoles,
      alert.userId,
    )
    const dispatchReason = this.buildDispatchReason(
      step.step,
      resolved.missingRequiredRoles,
    )
    if (resolved.missingRequiredRoles.length > 0) {
      this.logger.error(
        `Alert ${alert.id} step ${step.step}: data-integrity bug — missing required roles: ${resolved.missingRequiredRoles.join(',')}. Enrollment gate should have caught this. Continuing with partial dispatch.`,
      )
    }

    // Bug 1 — idempotent dispatch. A re-run of evaluate()/fireT0 for the same
    // alert (an immediate-fire reading later re-evaluated by the single-reading
    // finalize, or the frontend 5-min timer racing the finalize cron) must NOT
    // create a second EscalationEvent for the same alert+step+recipients —
    // that's the doubled-T0 audit/timeline bug. Retries go through the separate
    // dispatchForExistingEvent path, so a NEW dispatchStep row for an
    // (alert, step, recipientRoles) triple is always a duplicate.
    const alreadyDispatched = await this.prisma.escalationEvent.findFirst({
      where: {
        alertId: alert.id,
        ladderStep: step.step,
        recipientRoles: { equals: resolved.recipientRoles },
      },
      select: { id: true },
    })
    if (alreadyDispatched) {
      this.logger.debug(
        `dispatchStep: ${step.step} for alert ${alert.id} → [${resolved.recipientRoles.join(',')}] already exists (${alreadyDispatched.id}); skipping duplicate`,
      )
      return
    }

    if (shouldQueue && practice) {
      const scheduledFor = nextBusinessHoursStart(now, practice)
      // Cluster 6 bug #11 — wrap EscalationEvent.create in deadlock retry.
      // Same shape as the persistAlert retry: under concurrent dispatch +
      // alert-resolution writes, this insert can deadlock against an
      // in-flight Notification write. Lose the row silently and the step
      // never fires.
      await withDeadlockRetry(
        `dispatchStep:queue:${alert.id}:${step.step}`,
        () =>
          this.prisma.escalationEvent.create({
            data: {
              alertId: alert.id,
              userId: alert.userId,
              escalationLevel: this.legacyLevelFor(args.ladderKind),
              reason: `Queued for business hours — ${step.step}${dispatchReason.suffix}`,
              ladderStep: step.step,
              // Persist what we'd dispatch when the queue fires. The cron will
              // re-resolve at fire time too (practice staff may change before
              // then), but we keep the snapshot for audit.
              recipientIds: resolved.recipientIds,
              recipientRoles: resolved.recipientRoles,
              notificationChannel: step.channels[0] ?? 'PUSH',
              afterHours: true,
              scheduledFor,
              // Finding 5 — queued by the escalation scheduler (cron); no
              // human actor.
              dispatchedBySystem: true,
            },
          }),
        this.logger,
      )
      this.logger.log(
        `Queued ${step.step} for alert ${alert.id} until ${scheduledFor.toISOString()}`,
      )
      return
    }

    // Cluster 6 bug #11 — wrap EscalationEvent.create + writeNotificationsAndEmit
    // in a single deadlock-retry scope. writeNotificationsAndEmit also does
    // Notification writes; if either side deadlocks, the whole pair retries.
    // EmailService send inside writeNotificationsAndEmit stays outside the
    // retry's transactional intent (idempotent at the Notification dedup
    // layer), but a deadlock on the DB writes here will retry the whole.
    await withDeadlockRetry(
      `dispatchStep:fire:${alert.id}:${step.step}`,
      async () => {
        const created = await this.prisma.escalationEvent.create({
          data: {
            alertId: alert.id,
            userId: alert.userId,
            escalationLevel: this.legacyLevelFor(args.ladderKind),
            reason: `${step.step} dispatched${dispatchReason.suffix}`,
            ladderStep: step.step,
            recipientIds: resolved.recipientIds,
            recipientRoles: resolved.recipientRoles,
            notificationChannel: step.channels[0] ?? 'PUSH',
            afterHours,
            notificationSentAt: now,
            // Finding 5 — fired by the escalation scheduler (cron); no
            // human actor.
            dispatchedBySystem: true,
          },
        })

        await this.writeNotificationsAndEmit({
          eventId: created.id,
          alert,
          step,
          recipientIds: resolved.recipientIds,
          recipientRoles: resolved.recipientRoles,
          afterHours,
          now,
          triggeredByResolution: false,
        })
      },
      this.logger,
    )
  }

  /**
   * Dispatches a pre-existing EscalationEvent (already inserted at queue-time
   * or retry-time). Used by firePendingScheduled for queued-from-after-hours
   * events + BP L2 #6 retries.
   */
  private async dispatchForExistingEvent(args: {
    eventId: string
    alert: AlertRow
    step: LadderStep
    ladderKind: LadderKind
    recipientRoles: RecipientRole[]
    practice: BusinessHoursConfig | null
    assignment: AssignmentRow | null
    now: Date
    triggeredByResolution: boolean
  }): Promise<void> {
    const resolved = await this.getRecipientUserIds(
      args.assignment,
      args.recipientRoles,
      args.alert.userId,
    )
    const dispatchReason = this.buildDispatchReason(
      args.step.step,
      resolved.missingRequiredRoles,
    )
    if (resolved.missingRequiredRoles.length > 0) {
      this.logger.error(
        `Alert ${args.alert.id} step ${args.step.step} (scheduled): data-integrity bug — missing required roles: ${resolved.missingRequiredRoles.join(',')}. Continuing with partial dispatch.`,
      )
    }

    const afterHours =
      args.practice != null && !isWithinBusinessHours(args.now, args.practice)

    // Cluster 6 bug #11 — wrap update + write in deadlock retry. Same
    // rationale as the dispatchStep wrappers above.
    await withDeadlockRetry(
      `dispatchForExistingEvent:${args.eventId}`,
      async () => {
        await this.prisma.escalationEvent.update({
          where: { id: args.eventId },
          data: {
            notificationSentAt: args.now,
            recipientIds: resolved.recipientIds,
            recipientRoles: resolved.recipientRoles,
            afterHours,
            reason: `${args.step.step} dispatched${args.triggeredByResolution ? ' (retry)' : ''}${dispatchReason.suffix}`,
          },
        })

        await this.writeNotificationsAndEmit({
          eventId: args.eventId,
          alert: args.alert,
          step: args.step,
          recipientIds: resolved.recipientIds,
          recipientRoles: resolved.recipientRoles,
          afterHours,
          now: args.now,
          triggeredByResolution: args.triggeredByResolution,
        })
      },
      this.logger,
    )
  }

  /**
   * Builds the `reason` suffix on EscalationEvent when required roles are
   * missing. Empty suffix when all required roles resolved. Appears on the
   * audit trail so ops can identify data-integrity bugs at-a-glance.
   */
  private buildDispatchReason(
    step: LadderStepId,
    missingRequiredRoles: RecipientRole[],
  ): { suffix: string } {
    void step
    if (missingRequiredRoles.length === 0) return { suffix: '' }
    return {
      suffix: ` — DISPATCH ERROR: missing required roles ${missingRequiredRoles.join(',')}`,
    }
  }

  /**
   * Fans out notifications to (recipient × channel), writes Notification rows
   * idempotently (@@unique([alertId, escalationEventId, userId, channel])),
   * and emits ESCALATION_DISPATCHED.
   */
  private async writeNotificationsAndEmit(args: {
    eventId: string
    alert: AlertRow
    step: LadderStep
    recipientIds: string[]
    recipientRoles: RecipientRole[]
    afterHours: boolean
    now: Date
    triggeredByResolution: boolean
  }): Promise<void> {
    const { alert, step, recipientIds, recipientRoles, eventId } = args

    // Trigger keys the bell-vs-alerts tab split. These ladder rows carry
    // `alertId` and render in the Alerts stream, so they are the alert-class
    // triggers the bell hides: T+0 is the alert's first dispatch (ALERT_CREATED),
    // later steps are ALERT_ESCALATION, and a resolution dispatch is
    // ALERT_RESOLVED. See project_notification_tab_split_2026_06_04.
    const dispatchTrigger: NotificationTrigger = args.triggeredByResolution
      ? 'ALERT_RESOLVED'
      : step.step === 'T0'
        ? 'ALERT_CREATED'
        : 'ALERT_ESCALATION'

    // Role ↔ recipientId pairing is 1:1 by position. getRecipientUserIds
    // preserves order.
    for (let i = 0; i < recipientIds.length; i++) {
      const userId = recipientIds[i]
      const role = recipientRoles[i] ?? 'PRIMARY_PROVIDER'
      const content = this.buildNotificationContent(
        alert,
        role,
        args.step.step,
        args.now,
      )
      if (!content) continue
      const { title, body } = content

      for (const channel of step.channels) {
        // F12 — clinical alerts NEVER mirror into the patient's in-app bell.
        // The patient still sees the alert via the /alerts list, the dashboard
        // banner, and (for airway/emergency tiers) the out-of-app PUSH. The
        // in-app DASHBOARD (bell) inbox is reserved for admin/care-team action
        // events (ack / resolve / HOLD / threshold / follow-up / gap-alert).
        // This single guard covers every clinical-alert ladder that lists
        // PATIENT as a recipient — BP Level 2, BP-L2 symptom-override, Tier 1
        // angioedema, the cohort-gated BP Level 1 HIGH (Manisha Open-Decisions
        // 2026-06-06 D6), and Tier 1 contraindication (Manisha D5) — so no
        // clinical Notification row leaks to the patient bell regardless of
        // tier. Provider / MD / Ops DASHBOARD rows are unaffected. EMAIL is
        // the active out-of-app channel for the patient rows.
        if (role === 'PATIENT' && channel === 'DASHBOARD') continue

        // DASHBOARD notifications are implicit via DeviationAlert rows; we
        // still write a row so the admin UI can surface the escalation timeline.
        await this.prisma.notification
          .create({
            data: {
              userId,
              alertId: alert.id,
              escalationEventId: eventId,
              channel,
              title,
              body,
              tips: [],
              dispatchTrigger,
            },
          })
          .catch((err: unknown) => {
            // P2002 = duplicate (@@unique retry idempotency). Safe to ignore.
            const code = (err as { code?: string })?.code
            if (code !== 'P2002') throw err
          })

        if (channel === 'EMAIL') {
          const email = await this.emailFor(userId)
          if (email) {
            // Email template builds its own patient-identifier block, so
            // pass the raw clinical message (not the bell-prefixed body)
            // to avoid double-printing "Patient: …" in the email.
            const rawMessage = this.pickMessageForRole(alert, role)
            if (rawMessage) {
              const rendered = escalationEmailBody({
                alert,
                step: step.step,
                role,
                message: rawMessage,
                adminBaseUrl: this.adminBaseUrl,
                patientBaseUrl: this.patientBaseUrl,
                afterHours: args.afterHours,
                now: args.now,
              })
              await this.emailService.sendEmail(email, rendered.subject, rendered.html, {
                template: `escalation_tier_${alert.tier ?? 'unknown'}_${role.toLowerCase()}`,
                templateVersion: EMAIL_TEMPLATE_VERSION,
                patientUserId: alert.userId,
                metadata: {
                  alertId: alert.id,
                  escalationEventId: eventId,
                  ladderStep: step.step,
                },
              })
            }
          }
        }
      }
    }

    const dispatched: EscalationDispatchedEvent = {
      alertId: alert.id,
      escalationEventId: eventId,
      userId: alert.userId,
      alertTier: alert.tier ?? 'UNKNOWN',
      ruleId: alert.ruleId,
      ladderStep: step.step,
      recipientIds,
      recipientRoles,
      channels: step.channels,
      afterHours: args.afterHours,
      dispatchedAt: args.now,
      triggeredByResolution: args.triggeredByResolution,
    }
    this.eventEmitter.emit(JOURNAL_EVENTS.ESCALATION_DISPATCHED, dispatched)
    this.logger.log(
      `Dispatched ${step.step} for alert ${alert.id} to ${recipientIds.length} recipient(s) (${step.channels.join('+')})${args.afterHours ? ' [after-hours]' : ''}${args.triggeredByResolution ? ' [retry]' : ''}`,
    )
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  private async loadAlert(alertId: string): Promise<AlertRow | null> {
    return this.prisma.deviationAlert.findUnique({
      where: { id: alertId },
      include: ALERT_INCLUDE,
    }) as Promise<AlertRow | null>
  }

  /**
   * Resolves recipient roles to user IDs. Returns parallel `recipientIds`
   * and `recipientRoles` arrays (same length) so downstream code can pair
   * each recipient with the role that put them on the list — important for
   * HEALPLACE_OPS which can expand to multiple users.
   *
   * Integrity rule (user correction):
   *  - PRIMARY_PROVIDER / BACKUP_PROVIDER / MEDICAL_DIRECTOR are required per
   *    phase/13 enrollment gate. Missing at dispatch time = data-integrity
   *    bug; added to `missingRequiredRoles` so the caller can log + flag.
   *  - HEALPLACE_OPS is soft: empty resolution logs a warning but doesn't
   *    flag the dispatch as broken (on-call rotation is post-MVP).
   *  - PATIENT is always resolvable (just alert.userId).
   */
  private async getRecipientUserIds(
    assignment: AssignmentRow | null,
    roles: RecipientRole[],
    patientUserId: string,
  ): Promise<{
    recipientIds: string[]
    recipientRoles: RecipientRole[]
    missingRequiredRoles: RecipientRole[]
  }> {
    const ids: string[] = []
    const flatRoles: RecipientRole[] = []
    const missing: RecipientRole[] = []
    let healplaceOpsIds: string[] | null = null

    for (const role of roles) {
      switch (role) {
        case 'PATIENT':
          ids.push(patientUserId)
          flatRoles.push(role)
          break
        case 'PRIMARY_PROVIDER':
          if (assignment?.primaryProviderId) {
            ids.push(assignment.primaryProviderId)
            flatRoles.push(role)
          } else {
            missing.push(role)
          }
          break
        case 'BACKUP_PROVIDER':
          if (assignment?.backupProviderId) {
            ids.push(assignment.backupProviderId)
            flatRoles.push(role)
          } else {
            missing.push(role)
          }
          break
        case 'MEDICAL_DIRECTOR':
          if (assignment?.medicalDirectorId) {
            ids.push(assignment.medicalDirectorId)
            flatRoles.push(role)
          } else {
            missing.push(role)
          }
          break
        case 'HEALPLACE_OPS':
          // Adjustment 1 — fallback resolver: all users with UserRole.HEALPLACE_OPS.
          // Lazy + cached per call. On-call rotation is post-MVP (V2-F #35).
          if (healplaceOpsIds === null) {
            healplaceOpsIds = await this.findHealplaceOpsUserIds()
          }
          if (healplaceOpsIds.length === 0) {
            this.logger.warn(
              'No HEALPLACE_OPS users found — step recipients empty for this role',
            )
          } else {
            for (const opsId of healplaceOpsIds) {
              ids.push(opsId)
              flatRoles.push(role)
            }
          }
          break
      }
    }

    return { recipientIds: ids, recipientRoles: flatRoles, missingRequiredRoles: missing }
  }

  private async findHealplaceOpsUserIds(): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { roles: { has: 'HEALPLACE_OPS' } },
      select: { id: true },
    })
    return users.map((u) => u.id)
  }

  /**
   * Gap 5 — caregiver dispatch. For each consented, active caregiver on a
   * real channel, delivers the signed-off caregiverMessage (Minimum Necessary
   * — no other PHI) via their channel: EMAIL (SMTP), DASHBOARD (account
   * caregiver inbox), or SMS (NoopSmsService until a provider is wired). A
   * CaregiverDispatchLog row (unique on alert+caregiver+channel) makes re-fired
   * alerts idempotent. Gated behind CAREGIVER_DISPATCH_ENABLED so production
   * stays silent until the capture/consent loop is live.
   */
  private async dispatchCaregiverNotification(
    payload: AlertCreatedEvent,
  ): Promise<void> {
    if (!CAREGIVER_ROUTED_RULES.has(payload.ruleId ?? '')) return
    if (process.env.CAREGIVER_DISPATCH_ENABLED !== 'true') return

    // Gap 5 — only consented, active, channel-set caregivers receive PHI.
    const caregivers = await this.findCaregivers(payload.userId)
    if (caregivers.length === 0) return

    const alert = await this.loadAlert(payload.alertId)
    if (!alert?.caregiverMessage) return
    const message = alert.caregiverMessage
    // Gap 5 (Bug 2) — name the patient in the email subject so the caregiver
    // can tell who it's about. The message body already names them via the
    // registry (ctx.patientName). Name only — Minimum Necessary.
    const patientDisplayName = alert.user?.name?.trim() || 'someone you care for'

    for (const caregiver of caregivers) {
      try {
        // Idempotency for non-Notification channels (email/SMS) — a re-fired
        // alert must not double-send. createMany skipDuplicates on the unique
        // (alertId, caregiverId, channel) returns count 0 when already sent.
        const logged = await this.prisma.caregiverDispatchLog.createMany({
          data: [
            { alertId: alert.id, caregiverId: caregiver.id, channel: caregiver.notifyChannel },
          ],
          skipDuplicates: true,
        })
        if (logged.count === 0) continue // already dispatched for this alert+channel

        let delivered = false
        switch (caregiver.notifyChannel) {
          case 'EMAIL': {
            if (!caregiver.email) break
            await this.emailService.sendEmail(
              caregiver.email,
              `Cardioplace — a health update about ${patientDisplayName}`,
              caregiverEmailHtml(caregiver.name, message),
              {
                template: 'caregiver_alert',
                templateVersion: EMAIL_TEMPLATE_VERSION,
                patientUserId: alert.userId,
                metadata: { alertId: alert.id, caregiverId: caregiver.id },
              },
            )
            delivered = true
            break
          }
          case 'DASHBOARD': {
            // Option A — caregiver is a User with an in-app inbox.
            if (!caregiver.caregiverUserId) break
            await this.prisma.notification.create({
              data: {
                userId: caregiver.caregiverUserId,
                alertId: alert.id,
                channel: 'DASHBOARD',
                title: 'Caregiver update',
                body: message,
                dispatchTrigger: 'CAREGIVER_UPDATE',
              },
            })
            delivered = true
            break
          }
          case 'SMS': {
            // MVP: caregivers are EMAIL-ONLY (CROSS_HANDOFF_ADDENDUM Decision 2).
            // SMS dispatch is gated OFF behind ENABLE_CAREGIVER_SMS (default
            // false) so it can be turned on post-MVP without re-plumbing. The
            // underlying SmsService is also a Noop today, but the flag is the
            // explicit product gate.
            if (process.env.ENABLE_CAREGIVER_SMS !== 'true') {
              this.logger.warn(
                `Caregiver SMS suppressed for ${caregiver.id} — ENABLE_CAREGIVER_SMS is off (MVP email-only).`,
              )
              break
            }
            if (!caregiver.phone) break
            await this.smsService.sendSms(caregiver.phone, message)
            delivered = true
            break
          }
          default:
            break // NONE — captured but not notifiable
        }

        // A6 — surface the caregiver dispatch in the canonical audit stream
        // (EscalationEvent) so it shows in the admin timeline + the 15-field
        // trail as a "Caregiver notified" row, not just CaregiverDispatchLog.
        if (delivered) {
          await this.prisma.escalationEvent.create({
            data: {
              alertId: alert.id,
              userId: alert.userId,
              escalationLevel: 'LEVEL_1',
              reason: `Caregiver notified (${caregiver.notifyChannel.toLowerCase()})`,
              ladderStep: 'T0',
              recipientIds: [caregiver.caregiverUserId ?? caregiver.id],
              recipientRoles: ['CAREGIVER'],
              // NotificationChannel enum has no SMS — map text to PHONE for
              // the audit row's channel chrome.
              notificationChannel:
                caregiver.notifyChannel === 'SMS' ? 'PHONE' : caregiver.notifyChannel,
              notificationSentAt: new Date(),
              dispatchedBySystem: true,
            },
          })
        }
      } catch (err) {
        this.logger.warn(
          `Caregiver dispatch to ${caregiver.id} (${caregiver.notifyChannel}) failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }
  }

  /**
   * Gap 5 — caregivers eligible to receive an alert: active, consented
   * (consentGivenAt is the HIPAA hard gate), and on a real dispatch channel.
   */
  private async findCaregivers(patientUserId: string): Promise<
    Array<{
      id: string
      name: string
      email: string | null
      phone: string | null
      caregiverUserId: string | null
      notifyChannel: 'DASHBOARD' | 'SMS' | 'EMAIL'
    }>
  > {
    const rows = await this.prisma.patientCaregiver.findMany({
      where: {
        patientUserId,
        active: true,
        consentGivenAt: { not: null },
        notifyChannel: { not: 'NONE' },
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        caregiverUserId: true,
        notifyChannel: true,
      },
    })
    return rows as Array<{
      id: string
      name: string
      email: string | null
      phone: string | null
      caregiverUserId: string | null
      notifyChannel: 'DASHBOARD' | 'SMS' | 'EMAIL'
    }>
  }

  private pickMessageForRole(alert: AlertRow, role: RecipientRole): string | null {
    if (role === 'PATIENT') return alert.patientMessage ?? null
    // All provider + ops roles use the clinical-shorthand physicianMessage.
    return alert.physicianMessage ?? alert.caregiverMessage ?? null
  }

  private titleForRoleAndTier(
    role: RecipientRole,
    step: LadderStepId,
    tier: string | null,
  ): string {
    if (role === 'PATIENT') {
      if (tier === 'TIER_1_ANGIOEDEMA') {
        return 'Urgent — get medical help now'
      }
      if (tier === 'BP_LEVEL_2' || tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') {
        return 'Urgent Blood Pressure Alert'
      }
      return 'Cardioplace Alert'
    }
    // Cluster 8 — angioedema is an airway emergency; surface it ahead of
    // BP emergencies in the provider email subject.
    if (tier === 'TIER_1_ANGIOEDEMA') {
      return `[${step}] AIRWAY EMERGENCY (ANGIOEDEMA) — Patient needs review`
    }
    const isEmergency =
      tier === 'BP_LEVEL_2' || tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE'
    const isTier1 = tier === 'TIER_1_CONTRAINDICATION'
    const prefix = isEmergency
      ? 'BP EMERGENCY'
      : isTier1
        ? 'TIER 1 CONTRAINDICATION'
        : 'Tier 2 Review'
    return `[${step}] ${prefix} — Patient needs review`
  }

  /**
   * Build the in-app notification {title, body} for one (alert, recipient)
   * pair. Centralises wording so the bell + Alerts & Notifications page
   * stay consistent with the email template across every tier.
   *
   * Non-PATIENT recipients get the patient identifier prepended to both
   * title and body — without it, OPS/MED_DIR/SUPER/PROVIDER can't tell
   * which patient triggered the alert from the bell preview. The body
   * keeps the canonical Manisha-signed-off physicianMessage verbatim
   * (no truncation — clinical instructions like "do not take any more
   * of your medicine" in angioedema must reach the provider intact).
   *
   * PATIENT recipients keep the existing wording — they don't need to be
   * told their own name, and tier-specific titles ("Urgent — get medical
   * help now") are already tuned by clinical sign-off.
   */
  private buildNotificationContent(
    alert: AlertRow,
    role: RecipientRole,
    step: LadderStepId,
    now: Date,
  ): { title: string; body: string } | null {
    const message = this.pickMessageForRole(alert, role)
    if (!message) return null

    const baseTitle = this.titleForRoleAndTier(role, step, alert.tier)
    if (role === 'PATIENT') {
      return { title: baseTitle, body: message }
    }

    // Non-PATIENT — prepend patient identity to title + body. Name falls
    // back to email when missing (seed accounts), then to "patient" as a
    // last resort so we never render a bare "[T+0] — Tier 1 …".
    const name =
      alert.user.name ??
      alert.user.email ??
      'patient'
    const age = ageFromDob(alert.user.dateOfBirth, now)
    const identifier = age != null ? `${name} (age ${age})` : name

    // Title — replace "Patient needs review" suffix with the patient label
    // so the bell preview tells the reader who, not just what.
    const title = baseTitle.replace(
      / — Patient needs review$/,
      ` — ${identifier}`,
    )

    // Body — patient header line + canonical clinical message. Two newlines
    // so the bell + notifications page can render them as separate blocks.
    const body = `Patient: ${identifier}\n\n${message}`

    return { title, body }
  }

  private async emailFor(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    })
    return u?.email ?? null
  }

  /** Maps phase/7 ladder kinds back to the legacy EscalationLevel enum until
   * the column is dropped. LEVEL_2 = Tier 1 + BP Level 2 (safety-critical),
   * LEVEL_1 = Tier 2 + BP Level 1 (non-emergent provider attention). */
  private legacyLevelFor(kind: LadderKind): 'LEVEL_1' | 'LEVEL_2' {
    return kind === 'TIER_2' || kind === 'BP_LEVEL_1' ? 'LEVEL_1' : 'LEVEL_2'
  }
}

// ─── alert-row include + types (shared fetch shape) ─────────────────────────

// Wider include than v1 — escalation emails now embed patient identifiers
// (name, email, DOB → age), the latest reading, and per-alert clinical
// metadata (pulse pressure, suboptimal-measurement flag, mode). Practice.name
// + business hours travel together so the email template can render the
// practice tag in the subject, the practice-local timestamp in the body, and
// the after-hours queueing pill where applicable.
const ALERT_INCLUDE = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      displayId: true,
      dateOfBirth: true,
      enrollmentStatus: true,
      providerAssignmentAsPatient: {
        select: {
          primaryProviderId: true,
          backupProviderId: true,
          medicalDirectorId: true,
          practice: {
            select: {
              name: true,
              businessHoursStart: true,
              businessHoursEnd: true,
              businessHoursTimezone: true,
            },
          },
        },
      },
    },
  },
  journalEntry: {
    select: {
      systolicBP: true,
      diastolicBP: true,
      pulse: true,
      position: true,
      measuredAt: true,
    },
  },
} as const

interface AlertRow {
  id: string
  userId: string
  tier: string | null
  ruleId: string | null
  // Phase/22 — clinical metadata surfaced in the email body so the provider
  // sees mode (STANDARD / PERSONALIZED), pulse pressure, and the
  // suboptimal-measurement flag without having to click into the dashboard.
  mode: string | null
  pulsePressure: number | null
  suboptimalMeasurement: boolean
  createdAt: Date
  status: string
  acknowledgedAt: Date | null
  patientMessage: string | null
  caregiverMessage: string | null
  physicianMessage: string | null
  user: {
    id: string
    name: string | null
    email: string | null
    // Permanent human-readable identifier (CP-PAT-... / CP-STF-...).
    // Surfaced in the email subject for staff recipients so they can
    // cross-reference with their own systems. See
    // docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md.
    displayId: string | null
    dateOfBirth: Date | null
    // Layer B dispatch gate — escalation only fires for patients the admin
    // has passed through the 4-piece enrollment gate (assignment + practice
    // business hours + profile + threshold-if-HFREF/HCM/DCM). See
    // TESTING_FLOW_GUIDE.md §6.2.
    enrollmentStatus: 'NOT_ENROLLED' | 'ENROLLED'
    providerAssignmentAsPatient: AssignmentRow | null
  }
  journalEntry: JournalEntrySnapshot | null
}

interface AssignmentRow {
  primaryProviderId: string
  backupProviderId: string
  medicalDirectorId: string
  practice: {
    name: string
    businessHoursStart: string
    businessHoursEnd: string
    businessHoursTimezone: string
  }
}

interface JournalEntrySnapshot {
  systolicBP: number | null
  diastolicBP: number | null
  pulse: number | null
  position: string | null
  measuredAt: Date
}

// ─── email body ─────────────────────────────────────────────────────────────
//
// Tier-aware HTML template that wraps the role-picked clinical message
// (physicianMessage / caregiverMessage / patientMessage) in a detailed
// envelope: patient identifiers, latest reading + position, pulse pressure
// (with wide-PP flag), suboptimal-measurement flag, alert mode, escalation
// step pill, after-hours explanation, deep link to the admin dashboard, and a
// stable footer with alert + patient IDs for ops reference. Returns subject
// + html so the patient name renders in both the inbox preview and the body
// via one pass.
function escalationEmailBody(args: {
  alert: AlertRow
  step: LadderStepId
  role: RecipientRole
  message: string
  adminBaseUrl: string
  patientBaseUrl: string
  afterHours: boolean
  now: Date
}): { subject: string; html: string } {
  const { alert, step, role, message, adminBaseUrl, patientBaseUrl, afterHours, now } = args

  const patientName = alert.user.name?.trim() || 'Patient (name unknown)'
  const patientEmail = alert.user.email ?? ''
  const age = ageFromDob(alert.user.dateOfBirth, now)
  const dobStr = alert.user.dateOfBirth
    ? alert.user.dateOfBirth.toISOString().slice(0, 10)
    : '(DOB unknown)'
  const ageStr = age != null ? `age ${age}` : 'age unknown'
  const practice =
    alert.user.providerAssignmentAsPatient?.practice ?? null
  const practiceName = practice?.name ?? '(practice not assigned)'
  const practiceTz = practice?.businessHoursTimezone ?? 'UTC'

  const tierLabel = tierLabelFor(alert.tier)
  const tierColor = tierColorFor(alert.tier)
  const isPatient = role === 'PATIENT'

  // Subject — patient-role emails keep the friendly, non-alarming title.
  // Staff subjects carry NO patient identifier (HIPAA Minimum Necessary
  // §164.502(b) — passes the lockscreen test). The patient is referenced by
  // the non-PHI displayId inside the body only.
  const subject = isPatient
    ? patientSubject(alert.tier)
    : `[Cardioplace] ${tierLabel} - ${practiceName}`

  const stepPill = `${humanStep(step)}${afterHours ? ' (after-hours queued)' : ''}`
  const ackFooter = ackFooterFor(alert.tier)
  // Route patient recipients into the patient app's alert detail page; all
  // other recipients (provider/admin) deep-link into the admin dashboard.
  // Same admin URL for a patient-role recipient would land them on a 403/404
  // since /patients/{userId} is provider-only.
  const dashboardUrl = isPatient
    ? `${patientBaseUrl}/alerts/${encodeURIComponent(alert.id)}`
    : `${adminBaseUrl}/patients/${encodeURIComponent(alert.userId)}?alert=${encodeURIComponent(alert.id)}`
  const ctaLabel = isPatient ? 'View your alert →' : 'View in dashboard →'

  // Recipient role banner — clarifies why THIS person is getting THIS email.
  // Skipped for PATIENT-role to avoid alarming wording like "as the patient".
  const recipientBanner = isPatient
    ? ''
    : `<div style="margin-top:14px;padding:10px 14px;background:#eef2ff;border-radius:6px;font-size:12.5px;color:#3730a3">You are receiving this notification as the <strong>${escapeHtml(roleLabel(role))}</strong>.</div>`

  // Reading block — BP, pulse, pulse pressure, position, measurement
  // timestamp (UTC + practice-local). Only renders when a JournalEntry
  // snapshot is on the alert (mostly always — created from a reading).
  const readingBlock = alert.journalEntry
    ? renderReadingBlock(alert.journalEntry, alert.pulsePressure, practiceTz)
    : ''

  // Suboptimal-measurement banner — patient missed at least one of the
  // pre-measurement checklist items (caffeine / smoking / cuff position
  // etc). Provider should weigh this before acting on the BP value.
  const suboptimalBanner = alert.suboptimalMeasurement
    ? `<div style="margin-top:12px;padding:10px 14px;background:#fef2f2;border-radius:6px;font-size:12.5px;color:#991b1b"><strong>⚠ Suboptimal measurement conditions.</strong> Patient flagged at least one pre-measurement checklist item (caffeine, smoking, recent activity, posture, or cuff position). Interpret the reading with this caveat.</div>`
    : ''

  // After-hours explanation — only render when the dispatch was queued or
  // marked as a backup courtesy fire. Helps a recipient understand why they
  // are paged at 11pm or why the primary hasn't responded yet.
  const afterHoursBlock = afterHours
    ? `<div style="margin-top:12px;padding:10px 14px;background:#fff7ed;border-radius:6px;font-size:12.5px;color:#9a3412"><strong>After-hours dispatch.</strong> The primary provider's notification is queued for the next business window (${escapeHtml(practiceName)} — ${escapeHtml(practice?.businessHoursStart ?? '')}–${escapeHtml(practice?.businessHoursEnd ?? '')} ${escapeHtml(practiceTz)}). This courtesy notification is sent to the backup so a clinician is aware overnight.</div>`
    : ''

  // Alert-metadata strip — small grey row of at-a-glance facts that don't
  // need a full block but matter for triage: tier label, ladder step, mode,
  // ruleId.
  const metaItems: string[] = [
    `Tier: <strong>${escapeHtml(tierLabel)}</strong>`,
    `Step: <strong>${escapeHtml(humanStep(step))}</strong>`,
  ]
  if (alert.mode) metaItems.push(`Mode: <strong>${escapeHtml(alert.mode)}</strong>`)
  if (alert.ruleId) metaItems.push(`Rule: <strong>${escapeHtml(alert.ruleId)}</strong>`)
  const metaStrip = `<div style="margin-top:14px;font-size:12px;color:#6b7280;line-height:1.55">${metaItems.join(' &middot; ')}</div>`

  // Timestamp block — alert created at, in both UTC and practice-local.
  const createdUtc = alert.createdAt.toISOString()
  const createdLocal = formatInTz(alert.createdAt, practiceTz)
  const createdLine = `<div style="margin-top:6px;font-size:12px;color:#6b7280">Alert created: <strong>${escapeHtml(createdLocal)}</strong> <span style="color:#9ca3af">(${escapeHtml(createdUtc)})</span></div>`

  // Footer with stable IDs so anyone replying via phone or Slack can
  // reference exactly which alert / patient. Prefer the human-readable
  // displayId when present (CP-PAT-...); fall back to the ULID. The
  // displayId is the cross-system handle clinicians actually want to use.
  const patientRefId = alert.user.displayId
    ? formatDisplayIdForView(alert.user.displayId)
    : alert.userId
  const idFooter = `<div style="margin-top:18px;font-size:11px;color:#9ca3af;font-family:ui-monospace,SFMono-Regular,monospace">Alert ID: ${escapeHtml(alert.id)} &middot; Patient ID: ${escapeHtml(patientRefId)}</div>`

  // Standardized HIPAA confidentiality footer — rendered on BOTH the patient
  // and the provider/MD/Ops emails (one definition, one place to update).
  const confidentialityFooter = `<hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>
  <p style="font-size:11px;color:#9ca3af">Sent by Cardioplace escalation service. Do not reply to this email. This email may contain protected health information. If you received it in error, please notify the sender and delete it without forwarding or printing.</p>`

  // Patient recipients are the data subject — they see their own reading and
  // clinical message (their own data, not a PHI disclosure). Keep this body
  // exactly as before.
  const patientHtml = `<html><body style="font-family:system-ui,-apple-system,sans-serif;max-width:620px;margin:auto;padding:24px;color:#111827">
  <div style="border-left:4px solid ${tierColor};padding:16px 20px;background:#f9fafb;border-radius:6px">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${tierColor}">${escapeHtml(tierLabel)} &middot; ${escapeHtml(stepPill)}</div>
    <div style="font-size:20px;font-weight:700;margin-top:6px;color:#111827">${escapeHtml(patientName)}</div>
    <div style="font-size:13px;color:#6b7280;margin-top:2px">${escapeHtml(patientEmail)} &middot; DOB ${escapeHtml(dobStr)} &middot; ${escapeHtml(ageStr)}</div>
    <div style="font-size:13px;color:#6b7280;margin-top:2px">Practice: ${escapeHtml(practiceName)}</div>
  </div>
  ${recipientBanner}
  <div style="margin-top:20px;font-size:14px;line-height:1.6;color:#111827;font-weight:500">${escapeHtml(message)}</div>
  ${readingBlock}
  ${suboptimalBanner}
  ${afterHoursBlock}
  ${metaStrip}
  ${createdLine}
  <div style="margin-top:22px"><a href="${escapeAttr(dashboardUrl)}" style="display:inline-block;padding:11px 20px;background:${tierColor};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">${escapeHtml(ctaLabel)}</a></div>
  ${ackFooter ? `<div style="margin-top:18px;padding:12px 14px;background:#fef3c7;border-radius:6px;font-size:12.5px;color:#78350f"><strong>Acknowledgment expected.</strong> ${escapeHtml(ackFooter)}</div>` : ''}
  ${idFooter}
  ${confidentialityFooter}
</body></html>`

  // Provider / MD / Ops recipients get the HIPAA "notify-and-link" body:
  // NO patient PHI (no name, email, DOB, age, BP/pulse/position, clinical
  // narrative, or rule metadata) — only the alert tier, practice, ack window,
  // the non-PHI displayId reference, and a dashboard deep-link. Minimum
  // Necessary §164.502(b); see the HIPAA-sprint email-refactor appendix.
  const providerHtml = `<html><body style="font-family:system-ui,-apple-system,sans-serif;max-width:620px;margin:auto;padding:24px;color:#111827">
  <div style="border-left:4px solid ${tierColor};padding:16px 20px;background:#f9fafb;border-radius:6px">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${tierColor}">${escapeHtml(tierLabel)} &middot; ${escapeHtml(stepPill)}</div>
    <div style="font-size:15px;margin-top:8px;color:#111827">You have a new <strong>${escapeHtml(tierLabel)}</strong> alert from a patient in your practice.</div>
  </div>
  ${recipientBanner}
  <div style="margin-top:18px;font-size:13.5px;color:#374151;line-height:1.7">
    <div>Practice: <strong>${escapeHtml(practiceName)}</strong></div>
    ${ackFooter ? `<div>Acknowledgment expected: <strong>${escapeHtml(ackFooter)}</strong></div>` : ''}
    <div>Patient reference ID: <strong>${escapeHtml(patientRefId)}</strong></div>
  </div>
  <div style="margin-top:22px"><a href="${escapeAttr(dashboardUrl)}" style="display:inline-block;padding:11px 20px;background:${tierColor};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">${escapeHtml(ctaLabel)}</a></div>
  ${idFooter}
  ${confidentialityFooter}
</body></html>`

  const html = isPatient ? patientHtml : providerHtml

  return { subject, html }
}

function renderReadingBlock(
  entry: JournalEntrySnapshot,
  pulsePressure: number | null,
  practiceTz: string,
): string {
  const sbp = entry.systolicBP
  const dbp = entry.diastolicBP
  const pulse = entry.pulse
  const position = entry.position
  const utc = entry.measuredAt.toISOString()
  const local = formatInTz(entry.measuredAt, practiceTz)

  const bpPart =
    sbp != null && dbp != null
      ? `${sbp}/${dbp} mmHg`
      : sbp != null
        ? `${sbp} mmHg systolic`
        : '(no BP)'
  const pulsePart = pulse != null ? ` &middot; pulse <strong>${pulse}</strong>` : ''
  const ppPart =
    pulsePressure != null
      ? ` &middot; pulse pressure <strong>${pulsePressure}</strong>${pulsePressure > 60 ? ' <span style="color:#b91c1c">(wide)</span>' : ''}`
      : ''
  const posPart = position
    ? ` &middot; position <strong>${escapeHtml(position)}</strong>`
    : ''

  return `<div style="margin-top:14px;padding:12px 14px;background:#f3f4f6;border-radius:6px;font-size:13px;color:#111827">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;margin-bottom:4px">Latest reading</div>
    <div><strong>${escapeHtml(bpPart)}</strong>${pulsePart}${ppPart}${posPart}</div>
    <div style="margin-top:4px;font-size:12px;color:#6b7280">Recorded <strong>${escapeHtml(local)}</strong> <span style="color:#9ca3af">(${escapeHtml(utc)})</span></div>
  </div>`
}

function formatInTz(d: Date, tz: string): string {
  // "Apr 22, 2026, 06:00 AM EDT" — readable, timezone-aware. Falls back to
  // ISO if the runtime can't honour the tz (defensive — should never fire
  // since Node 16+ ships full ICU).
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: tz,
    }).format(d)
  } catch {
    return d.toISOString()
  }
}

function roleLabel(role: RecipientRole): string {
  switch (role) {
    case 'PRIMARY_PROVIDER':
      return 'primary provider'
    case 'BACKUP_PROVIDER':
      return 'backup provider'
    case 'MEDICAL_DIRECTOR':
      return 'medical director'
    case 'HEALPLACE_OPS':
      return 'Healplace ops'
    case 'PATIENT':
      return 'patient'
    default:
      return role
  }
}

function ageFromDob(dob: Date | null, now: Date): number | null {
  if (!dob) return null
  const ms = now.getTime() - dob.getTime()
  if (ms < 0) return null
  const years = ms / (365.25 * 24 * 3600 * 1000)
  return Math.floor(years)
}

// Formats a canonical display ID ("CPPATK8M2R4N7") with hyphens for human
// display ("CP-PAT-K8M2R4N-7"). Defensive: if input is already hyphenated
// or off the expected length, returns it verbatim. Mirrors the formatter
// in DisplayIdService (kept local to avoid cross-module dependency from
// the escalation pipeline into the users module).
function formatDisplayIdForView(value: string): string {
  if (value.length !== 13 || value.includes('-')) return value
  return `${value.slice(0, 2)}-${value.slice(2, 5)}-${value.slice(5, 12)}-${value.slice(12)}`
}

function tierLabelFor(tier: string | null): string {
  if (tier === 'BP_LEVEL_2' || tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') {
    return 'BP EMERGENCY'
  }
  if (tier === 'TIER_1_ANGIOEDEMA') return 'AIRWAY EMERGENCY (ANGIOEDEMA)'
  if (tier === 'TIER_1_CONTRAINDICATION') return 'TIER 1 CONTRAINDICATION'
  if (tier === 'BP_LEVEL_1_HIGH') return 'BP LEVEL 1 HIGH'
  if (tier === 'BP_LEVEL_1_LOW') return 'BP LEVEL 1 LOW'
  if (tier === 'TIER_2_DISCREPANCY') return 'Tier 2 Review'
  return 'Cardioplace Alert'
}

function tierColorFor(tier: string | null): string {
  if (
    tier === 'BP_LEVEL_2' ||
    tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE' ||
    tier === 'TIER_1_CONTRAINDICATION' ||
    tier === 'TIER_1_ANGIOEDEMA'
  ) {
    return '#b91c1c' // red-700
  }
  // BP Level 1 + Tier 2 share the amber palette — non-emergency,
  // provider-attention-required-within-a-business-day.
  if (
    tier === 'BP_LEVEL_1_HIGH' ||
    tier === 'BP_LEVEL_1_LOW' ||
    tier === 'TIER_2_DISCREPANCY'
  ) {
    return '#b45309' // amber-700
  }
  return '#1d4ed8' // blue-700
}

function ackFooterFor(tier: string | null): string {
  if (tier === 'BP_LEVEL_2' || tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') {
    return 'If you do not acknowledge within 2 hours, the medical director will be paged. Healplace ops will phone the practice within 4 hours.'
  }
  if (tier === 'TIER_1_ANGIOEDEMA') {
    return 'AIRWAY EMERGENCY. If you do not acknowledge within 15 minutes, your backup provider is paged. If unresolved within 1 hour, the medical director and Healplace ops are notified.'
  }
  if (tier === 'TIER_1_CONTRAINDICATION') {
    return 'If you do not acknowledge within 4 hours, your backup provider will be paged. If unresolved within 8 hours, the medical director will be notified.'
  }
  if (tier === 'BP_LEVEL_1_HIGH' || tier === 'BP_LEVEL_1_LOW') {
    return 'If you do not acknowledge within 24 hours, your backup provider will be paged. If unresolved within 72 hours, the medical director will be notified.'
  }
  if (tier === 'TIER_2_DISCREPANCY') {
    return 'If unreviewed within 7 days, this alert will be escalated to your backup provider.'
  }
  return ''
}

function humanStep(step: LadderStepId): string {
  // The ladder uses ids like 'T0' / 'T2H' / 'T4H' / 'T8H' / 'T24H' / 'T48H'
  // / 'T72H' / 'T7D' / 'TIER2_*'. Render with a `+` so it's unambiguous in
  // the subject. Tier-2-prefixed ids drop the prefix for display.
  if (step === 'T0') return 'T+0'
  const stripped = step.replace(/^TIER2_/, '')
  return stripped.replace(/^T/, 'T+').toLowerCase().replace(/^t\+/, 'T+')
}

function patientSubject(tier: string | null): string {
  if (tier === 'TIER_1_ANGIOEDEMA') {
    return 'Urgent — get medical help now — Cardioplace'
  }
  if (tier === 'BP_LEVEL_2' || tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') {
    return 'Urgent Blood Pressure Alert — Cardioplace'
  }
  // Manisha Open-Decisions sign-off 2026-06-06 (Decision 5) — recommended
  // patient subject for contraindication alerts. Calm + actionable; pairs
  // with the registry patientMessage's "please don't stop any medicine
  // without talking to your doctor" framing in the body.
  if (tier === 'TIER_1_CONTRAINDICATION') {
    return 'Important medication alert from your care team — Cardioplace'
  }
  // Manisha Open-Decisions sign-off 2026-06-06 (Decision 6) — patient
  // subject for the re-instated, cohort-gated BP_LEVEL_1_HIGH email
  // (standard cohort only). Informative without alarming — frames the
  // reading as something the care team will follow up on.
  if (tier === 'BP_LEVEL_1_HIGH') {
    return 'Your recent blood pressure reading — Cardioplace'
  }
  return 'Cardioplace Alert'
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] as string,
  )
}

function escapeAttr(s: string): string {
  // URLs go in href attributes; reuse escapeHtml since the same five chars
  // need to be entitised in attribute context too.
  return escapeHtml(s)
}

// Re-export for tests that want the public ladder shape without re-importing.
export { TIER_1_LADDER }
// Re-export the email-body helper so spec files can render and assert on the
// output directly without spinning up the full Nest TestingModule.
export { escalationEmailBody }
