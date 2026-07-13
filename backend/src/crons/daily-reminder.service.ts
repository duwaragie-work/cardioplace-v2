import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ClsService } from 'nestjs-cls'
import {
  CARE_TEAM_GAP_TITLE,
  REMINDER_DAILY_TITLE,
  ReminderLanguage,
  careTeamGapBody,
  reminderBodyDay1,
  reminderBodyDay2,
  reminderBodyDay3Plus,
} from '@cardioplace/shared'
import { runAsCronActor } from '../common/cls/cron-actor.util.js'
import { AccountStatus, EnrollmentStatus } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  daysSinceLastReadingLocal,
  effectiveReminderSlot,
  hasLoggedReadingToday,
  isWithinQuietHours,
  localHour,
  localHourMinute,
  REMINDER_TZ_FALLBACK,
} from './daily-reminder/helpers.js'
import {
  ReminderChannel,
  ReminderDispatcherService,
} from './daily-reminder/reminder-dispatcher.service.js'

const SUPPORTED_LANGUAGES: readonly ReminderLanguage[] = ['en', 'es', 'am', 'fr', 'de'] as const
function resolveLanguage(pref: string | null | undefined): ReminderLanguage {
  const p = (pref ?? 'en').toLowerCase() as ReminderLanguage
  return SUPPORTED_LANGUAGES.includes(p) ? p : 'en'
}

function firstName(fullName: string | null | undefined, fallback: string): string {
  const n = (fullName ?? '').trim()
  if (!n) return fallback
  return n.split(/\s+/)[0]
}

// Idempotency window (mirrors gap-alert.service.ts:14) — a Notification with
// this title created within IDEMPOTENCY_HOURS blocks another daily-reminder
// dispatch for the same user, so if the cron re-runs mid-day or a slot lines
// up twice, we don't double-send.
const IDEMPOTENCY_HOURS = 20

/** Channels every patient receives by default. SMS is included in the fan-out
 *  today but the dispatcher no-ops until Lakshitha's L5 lands the transport. */
const DEFAULT_REMINDER_CHANNELS: readonly ReminderChannel[] = [
  'DASHBOARD',
  'PUSH',
  'EMAIL',
  'SMS',
] as const

/** Provider-facing gap alert only fans out to DASHBOARD + EMAIL — no push
 *  registrations for admins by default, no SMS opt-in flow for staff yet. */
const CARE_TEAM_CHANNELS: readonly ReminderChannel[] = ['DASHBOARD', 'EMAIL'] as const

/**
 * N2 + N4 + N5 (2026-07-13) — Patient reminder & engagement cron.
 *
 * Runs every 30 minutes. For each active patient whose local wall-clock
 * matches their `reminderTime` slot AND who hasn't logged today AND isn't
 * in quiet hours, dispatch an escalating-tone reminder over their opted
 * channels. If the reading gap has hit day 3, 6, 9, ... additionally
 * dispatch a care-team notice to the primary provider.
 *
 * Governing principle: "engages, does not pressure". Copy lives in
 * @cardioplace/shared so admin and patient surfaces stay in sync. Emergency
 * paths (BP L2, angioedema, Tier 1 ladder) DO NOT go through this cron —
 * they run via alert-engine.service.ts + escalation.service.ts and MUST NOT
 * be quiet-hour suppressed.
 */
@Injectable()
export class DailyReminderService {
  private readonly logger = new Logger(DailyReminderService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: ReminderDispatcherService,
    private readonly cls: ClsService,
  ) {}

  @Cron('*/30 * * * *')
  async scheduledRun() {
    return runAsCronActor(this.cls, 'cron-daily-reminder', async () => {
      const summary = await this.runScan()
      this.logger.log(
        `Daily reminder scan complete: dispatched=${summary.dispatched} ` +
          `skipped_logged=${summary.skippedLoggedToday} ` +
          `skipped_quiet=${summary.skippedQuietHours} ` +
          `skipped_slot=${summary.skippedNotSlot} ` +
          `skipped_idempotent=${summary.skippedIdempotent} ` +
          `care_team_alerts=${summary.careTeamAlerts}`,
      )
    })
  }

  /**
   * One scan cycle. Exposed publicly so ops tooling / the Playwright
   * test-control seam / a Nest smoke spec can trigger it without waiting
   * for a 30-minute slot.
   */
  async runScan(now: Date = new Date()): Promise<DailyReminderScanSummary> {
    const summary: DailyReminderScanSummary = {
      dispatched: 0,
      skippedLoggedToday: 0,
      skippedQuietHours: 0,
      skippedNotSlot: 0,
      skippedIdempotent: 0,
      careTeamAlerts: 0,
    }
    const idempotencyCutoff = new Date(
      now.getTime() - IDEMPOTENCY_HOURS * 60 * 60 * 1000,
    )

    const patients = await this.prisma.user.findMany({
      where: {
        accountStatus: AccountStatus.ACTIVE,
        enrollmentStatus: EnrollmentStatus.ENROLLED,
        roles: { has: 'PATIENT' },
      },
      select: {
        id: true,
        email: true,
        name: true,
        timezone: true,
        reminderTime: true,
        quietHoursStart: true,
        quietHoursEnd: true,
        preferredLanguage: true,
      },
    })

    for (const p of patients) {
      try {
        const tz = p.timezone ?? REMINDER_TZ_FALLBACK
        const currentSlot = localHourMinute(now, tz)

        // N6 shift rule — if the raw reminderTime falls inside quiet hours,
        // fire at the end-of-quiet-hours edge instead. `effectiveReminderSlot`
        // returns null when no reminderTime is set at all.
        const effective = effectiveReminderSlot({
          reminderTime: p.reminderTime,
          quietHoursStart: p.quietHoursStart,
          quietHoursEnd: p.quietHoursEnd,
        })
        if (!effective || currentSlot !== effective) {
          summary.skippedNotSlot++
          continue
        }

        // Safety net — even after the shift, if `now` still falls inside
        // the quiet window (e.g. current time exactly equals quietStart
        // because of a misconfigured pair), skip. This keeps the invariant
        // "no daily reminder ever fires INSIDE quiet hours" absolute.
        if (
          isWithinQuietHours(
            {
              quietHoursStart: p.quietHoursStart,
              quietHoursEnd: p.quietHoursEnd,
              timezone: p.timezone,
            },
            now,
          )
        ) {
          summary.skippedQuietHours++
          continue
        }

        if (await hasLoggedReadingToday(this.prisma, p.id, tz, now)) {
          summary.skippedLoggedToday++
          continue
        }

        // Idempotency — title equality mirrors gap-alert.service.ts:81-88.
        const recent = await this.prisma.notification.findFirst({
          where: {
            userId: p.id,
            title: REMINDER_DAILY_TITLE,
            sentAt: { gte: idempotencyCutoff },
          },
          select: { id: true },
        })
        if (recent) {
          summary.skippedIdempotent++
          continue
        }

        const days = await daysSinceLastReadingLocal(this.prisma, p.id, tz, now)
        // If daysSinceLastReadingLocal returned 0 the hasLoggedReadingToday
        // guard above would have already skipped — treat 0 as a safety net.
        if (days === 0) {
          summary.skippedLoggedToday++
          continue
        }

        const language = resolveLanguage(p.preferredLanguage)
        const hour = localHour(now, tz)
        const fname = firstName(p.name, 'friend')
        const body = renderTierBody(fname, days, hour, language)
        await this.dispatcher.dispatch(
          { userId: p.id, email: p.email, name: fname },
          {
            title: REMINDER_DAILY_TITLE,
            body,
            emailTemplate: 'daily_reminder',
            metadata: {
              dayCount: Number.isFinite(days) ? days : 999,
              tz,
            },
          },
          DEFAULT_REMINDER_CHANNELS,
        )
        summary.dispatched++

        // N5 — every 3-day tick, ping the care team. Modulo-check IS the
        // idempotency: only days 3/6/9/12/... hit this branch. The recipient
        // filter below is belt-and-suspenders against a re-run in the same day.
        if (Number.isFinite(days) && days >= 3 && days % 3 === 0) {
          await this.dispatchCareTeamAlert(p.id, p.name ?? 'the patient', days, idempotencyCutoff)
          summary.careTeamAlerts++
        }
      } catch (err) {
        // One bad patient must not starve the loop. Log + continue.
        this.logger.error(
          `Daily reminder failed for user=${p.id}`,
          err instanceof Error ? err.stack : String(err),
        )
      }
    }

    return summary
  }

  private async dispatchCareTeamAlert(
    patientId: string,
    patientName: string,
    days: number,
    idempotencyCutoff: Date,
  ): Promise<void> {
    const assignment = await this.prisma.patientProviderAssignment.findUnique({
      where: { userId: patientId },
      select: {
        primaryProvider: { select: { id: true, email: true, name: true } },
      },
    })
    if (!assignment?.primaryProvider) {
      this.logger.warn(
        `Care-team gap alert: no primary provider assigned to patient=${patientId}`,
      )
      return
    }
    const provider = assignment.primaryProvider

    const recent = await this.prisma.notification.findFirst({
      where: {
        userId: provider.id,
        patientUserId: patientId,
        title: CARE_TEAM_GAP_TITLE,
        sentAt: { gte: idempotencyCutoff },
      },
      select: { id: true },
    })
    if (recent) return

    await this.dispatcher.dispatch(
      {
        userId: provider.id,
        email: provider.email,
        name: provider.name ?? 'Care team',
        patientUserId: patientId,
      },
      {
        title: CARE_TEAM_GAP_TITLE,
        body: careTeamGapBody(patientName, days),
        emailTemplate: 'care_team_gap_alert',
        metadata: {
          patientUserId: patientId,
          daysSinceLastReading: days,
        },
      },
      CARE_TEAM_CHANNELS,
    )
  }
}

function renderTierBody(
  name: string,
  days: number,
  hour: number,
  language: ReminderLanguage,
): string {
  if (!Number.isFinite(days) || days >= 3) {
    return reminderBodyDay3Plus(name, Math.min(days, 30), language)
  }
  if (days === 1) return reminderBodyDay1(name, hour, language)
  if (days === 2) return reminderBodyDay2(name, language)
  // days === 0 already skipped by hasLoggedReadingToday guard, but fall
  // through to the friendliest tier if this is somehow reached.
  return reminderBodyDay1(name, hour, language)
}

export interface DailyReminderScanSummary {
  dispatched: number
  skippedLoggedToday: number
  skippedQuietHours: number
  skippedNotSlot: number
  skippedIdempotent: number
  careTeamAlerts: number
}
