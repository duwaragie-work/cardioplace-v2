import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { SINGLE_READING_FINALIZE_MS } from '@cardioplace/shared'
import { DailyJournalService } from '../daily_journal/daily_journal.service.js'
import { PrismaService } from '../prisma/prisma.service.js'

// Don't re-walk ancient history: only consider readings from the last day. A
// reading older than this whose timer never fired is effectively abandoned and
// its single-reading alert is no longer clinically actionable.
const RECENT_FLOOR_MS = 24 * 60 * 60 * 1000

/**
 * Server-side safety net for the Cluster 6 Q2 single-reading finalize. The
 * patient app arms a 5-min timer that calls POST /finalize-single-reading, but
 * if the tab is closed before it fires the lone reading's informational alert
 * would otherwise be held indefinitely. This cron finalizes those expired
 * single-reading sessions so the alert fires regardless.
 *
 * Reuses DailyJournalService.shouldFinalizeAsSingleReading (the single source
 * of truth for "which lone readings deserve a single-reading alert" — excludes
 * AFib, Pre-Day-3, and anything with a sibling) and finalizeSingleReadingSession
 * (idempotent via the singleReadingFinalized guard).
 */
@Injectable()
export class SessionFinalizeService {
  private readonly logger = new Logger(SessionFinalizeService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyJournal: DailyJournalService,
  ) {}

  @Cron('*/2 * * * *') // every 2 min — ~2 min latency vs the frontend timer
  async scheduledRun() {
    const count = await this.runScan()
    if (count > 0) {
      this.logger.log(`Session-finalize scan complete: ${count} finalized`)
    }
  }

  /**
   * Finalizes lone readings whose finalize deadline elapsed without a second
   * reading. Public so tests / ops can trigger on demand.
   */
  async runScan(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - SINGLE_READING_FINALIZE_MS)
    const floor = new Date(now.getTime() - RECENT_FLOOR_MS)

    const candidates = await this.prisma.journalEntry.findMany({
      where: {
        singleReadingFinalized: false,
        measuredAt: { lte: cutoff, gte: floor },
        // Skip weight-only entries — they aren't BP/HR readings that fire a
        // single-reading alert.
        OR: [{ systolicBP: { not: null } }, { pulse: { not: null } }],
      },
      select: { id: true, userId: true, sessionId: true, measuredAt: true },
    })

    let finalized = 0
    for (const entry of candidates) {
      const shouldFinalize = await this.dailyJournal.shouldFinalizeAsSingleReading(
        entry.userId,
        entry,
      )
      if (!shouldFinalize) continue
      try {
        await this.dailyJournal.finalizeSingleReadingSession(entry.userId, entry.id)
        finalized++
      } catch (err) {
        this.logger.error(
          `Failed to finalize single-reading session for entry ${entry.id}`,
          err instanceof Error ? err.stack : undefined,
        )
      }
    }

    return finalized
  }
}
