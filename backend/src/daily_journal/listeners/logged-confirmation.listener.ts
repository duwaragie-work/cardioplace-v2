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
import type { JournalEntryEvaluatedEvent } from '../interfaces/events.interface.js'

const SUPPORTED_LANGUAGES: readonly ReminderLanguage[] = ['en', 'es', 'am', 'fr', 'de'] as const
function resolveLanguage(pref: string | null | undefined): ReminderLanguage {
  const p = (pref ?? 'en').toLowerCase() as ReminderLanguage
  return SUPPORTED_LANGUAGES.includes(p) ? p : 'en'
}

/**
 * N7 (2026-07-13) — "Logged ✓" push confirmation.
 *
 * Fires from JOURNAL_EVENTS.ENTRY_EVALUATED, which AlertEngineService emits
 * AFTER evaluate() has awaited every DeviationAlert commit for this entry
 * (Gap 1 fix, 2026-07-13). Listening on ENTRY_EVALUATED instead of
 * ENTRY_CREATED closes the spec-§N7 correctness gap: previously an AFib
 * patient whose reading was 118/76 / HR 115 got "Looking good" appended
 * because the BP band looked normal, even though the alert engine was
 * about to fire RULE_AFIB_HR_HIGH. Now the engine's verdict
 * (`payload.alertsFired`) is the primary gate; the BP-band predicate is a
 * belt-and-braces second gate that keeps the positive tail off any reading
 * outside the comfort window even in the rare case where the engine
 * assessed clean.
 *
 * Copy variants (spec §N7):
 *  • normal range AND no alerts fired → base + " Looking good — keep it up!"
 *  • anything else                    → base only, NO positive language.
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

  @OnEvent(JOURNAL_EVENTS.ENTRY_EVALUATED, { async: true })
  async onEntryEvaluated(payload: JournalEntryEvaluatedEvent): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.userId },
        select: { preferredLanguage: true },
      })
      const language = resolveLanguage(user?.preferredLanguage)
      // Gap 1 fix — the engine's verdict is the primary gate. BP-band check
      // is a defensive second gate: if for any reason the engine said "no
      // alert" but the numbers are outside the AHA comfort band, we still
      // withhold the positive tail rather than shipping a wrong-signal push.
      const bandNormal = isBpNormalRange(payload.systolicBP, payload.diastolicBP)
      const variant = !payload.alertsFired && bandNormal ? 'normal-range' : 'base'
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
