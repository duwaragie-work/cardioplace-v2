import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ClsService } from 'nestjs-cls'
import { SINGLE_READING_FINALIZE_MS } from '@cardioplace/shared'
import { runAsCronActor } from '../common/cls/cron-actor.util.js'
import { DailyJournalService } from '../daily_journal/daily_journal.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { EncryptionService } from '../common/encryption.service.js'
import {
  Prisma,
  VerifierRole,
  VerificationChangeType,
} from '../generated/prisma/client.js'

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
    private readonly cls: ClsService,
    private readonly encryption: EncryptionService,
  ) {}

  @Cron('*/2 * * * *') // every 2 min — ~2 min latency vs the frontend timer
  async scheduledRun() {
    return runAsCronActor(this.cls, 'cron-session-finalize', async () => {
      const count = await this.runScan()
      if (count > 0) {
        this.logger.log(`Session-finalize scan complete: ${count} finalized`)
      }
    })
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
      select: {
        id: true,
        userId: true,
        sessionId: true,
        measuredAt: true,
        // Option D (Manisha 2026-06-12 Q2) — distinguishes a held AWAITING
        // first-of-pair (→ UNCONFIRMED) from an ordinary non-emergency single
        // reading (→ existing single-reading finalize).
        emergencyConfirmation: true,
      },
    })

    let finalized = 0
    for (const entry of candidates) {
      // Option D app-closed safety net: a held emergency reading whose 5-min
      // confirmation window elapsed with no confirmatory reading resolves to
      // RULE_UNCONFIRMED_EMERGENCY (Tier 1 provider-only). finalizeUnconfirmed-
      // Emergency is idempotent (a CONFIRMATORY resolution already released the
      // hold, so this no-ops in that race).
      if (entry.emergencyConfirmation === 'AWAITING') {
        try {
          await this.dailyJournal.finalizeUnconfirmedEmergency(entry.userId, entry.id)
          finalized++
          await this.auditFinalize(entry)
        } catch (err) {
          this.logger.error(
            `Failed to finalize unconfirmed emergency for entry ${entry.id}`,
            err instanceof Error ? err.stack : undefined,
          )
        }
        continue
      }

      const shouldFinalize = await this.dailyJournal.shouldFinalizeAsSingleReading(
        entry.userId,
        entry,
      )
      if (!shouldFinalize) continue
      try {
        await this.dailyJournal.finalizeSingleReadingSession(entry.userId, entry.id)
        finalized++
        await this.auditFinalize(entry)
      } catch (err) {
        this.logger.error(
          `Failed to finalize single-reading session for entry ${entry.id}`,
          err instanceof Error ? err.stack : undefined,
        )
      }
    }

    return finalized
  }

  /**
   * Audit (2026-07-03, Humaira Activity 1 #3): the finalize flipped a
   * JournalEntry's `singleReadingFinalized` — a clinical-state change that,
   * like a manual edit, must leave a ProfileVerificationLog row. Attributed to
   * the system principal (cls actorId). Best-effort: the flip lives inside
   * DailyJournalService (shared with the frontend-timer / provider / voice
   * paths), so we log right after it succeeds rather than refactoring that hot
   * path into a shared transaction. Guarded on a resolved actorId (cold
   * registry → skip) and never throws (audit must not break the cron).
   */
  private async auditFinalize(entry: { id: string; userId: string }): Promise<void> {
    const actorId = this.cls.get<string | null>('actorId') ?? null
    if (!actorId) return
    try {
      await this.prisma.profileVerificationLog.create({
        data: {
          userId: entry.userId,
          fieldPath: `journalEntry:${entry.id}:singleReadingFinalized`,
          previousValue: { singleReadingFinalized: false } as Prisma.InputJsonValue,
          newValue: { singleReadingFinalized: true } as Prisma.InputJsonValue,
          changedBy: actorId,
          changedByRole: VerifierRole.SYSTEM_ACTOR,
          changeType: VerificationChangeType.SYSTEM_CRON_FINALIZE,
          discrepancyFlag: false,
          rationale: 'Cron flipped singleReadingFinalized after buffer window elapsed',
          rationaleEncrypted: this.encryption.encryptNullable(
            'Cron flipped singleReadingFinalized after buffer window elapsed',
          ),
          practiceContext: null,
        },
      })
    } catch (err) {
      this.logger.error(
        `Audit write failed for finalized entry ${entry.id}`,
        err instanceof Error ? err.stack : undefined,
      )
    }
  }
}
