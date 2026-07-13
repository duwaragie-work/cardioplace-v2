import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import {
  REMINDER_LOGGED_TITLE,
  ReminderLanguage,
  isBpNormalRange,
  reminderLoggedBody,
} from '@cardioplace/shared'
import { NotificationChannel } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import type { JournalEntryCreatedEvent } from '../interfaces/events.interface.js'

const SUPPORTED_LANGUAGES: readonly ReminderLanguage[] = ['en', 'es', 'am', 'fr', 'de'] as const
function resolveLanguage(pref: string | null | undefined): ReminderLanguage {
  const p = (pref ?? 'en').toLowerCase() as ReminderLanguage
  return SUPPORTED_LANGUAGES.includes(p) ? p : 'en'
}

/**
 * N7 (2026-07-13) — "Logged ✓" push confirmation.
 *
 * Fires immediately after a JournalEntry is persisted (see
 * daily_journal.service.ts:491) and creates a PUSH-channel Notification row
 * with a warm, no-BP-value body. The auto-push Prisma extension
 * (backend/src/push/web-push.service.ts:117-126) then dispatches the push
 * for us — no direct WebPushService call.
 *
 * Copy variants (spec §N7):
 *  • normal range → base + " Looking good — keep it up!"
 *  • anything else (edge case, or reading that will trip an alert rule)
 *    → base only, NO positive language.
 *
 * The normal-range predicate is a cheap SBP/DBP check
 * (`isBpNormalRange` in @cardioplace/shared) — it deliberately does NOT
 * query the alert engine's per-rule verdict. Rationale: (a) this listener
 * runs alongside the alert engine on the same ENTRY_CREATED event, so
 * the engine's DeviationAlert row isn't guaranteed to exist yet; (b) the
 * spec's directive is "no positive tail if alert triggers" — anything
 * outside the normal band is either an alert or borderline, and both
 * warrant withholding the "Looking good" tail; (c) keeps this path
 * decoupled from every rule file (standing rule: alert rules stay
 * untouched).
 *
 * Design notes:
 *  • PUSH ONLY (per spec §N7). No email, no SMS, no dashboard row.
 *    OS-level DND already respects the patient's quiet hours; adding
 *    another gate here would fight the OS.
 *  • Body carries NO BP values. Lock-screen previews may show the body,
 *    so a "125/78 mmHg" leak is a privacy issue on shared devices.
 *  • Never throws. A failed confirmation push must not derail the
 *    journal write path — the event is `async: true` and every branch
 *    is guarded.
 */
@Injectable()
export class LoggedConfirmationListener {
  private readonly logger = new Logger(LoggedConfirmationListener.name)

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(JOURNAL_EVENTS.ENTRY_CREATED, { async: true })
  async onEntryCreated(payload: JournalEntryCreatedEvent): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.userId },
        select: { preferredLanguage: true },
      })
      const language = resolveLanguage(user?.preferredLanguage)
      const variant = isBpNormalRange(payload.systolicBP, payload.diastolicBP)
        ? 'normal-range'
        : 'base'
      const body = reminderLoggedBody(variant, language)
      await this.prisma.notification.create({
        data: {
          userId: payload.userId,
          channel: NotificationChannel.PUSH,
          title: REMINDER_LOGGED_TITLE,
          body,
          dispatchTrigger: 'SYSTEM_CRON',
        },
      })
    } catch (err) {
      this.logger.error(
        `Logged-confirmation push failed for user=${payload.userId}`,
        err instanceof Error ? err.stack : String(err),
      )
    }
  }
}
