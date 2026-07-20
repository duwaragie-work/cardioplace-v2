/**
 * Phase/27 chatbot v2 — quick symptom logging.
 *
 * Powers the `log_symptom_quick` tool: patient says "I have severe headache
 * right now" and the bot calls this to fire an immediate symptom-only entry.
 * No BP, no pulse — just a structured symptom flag with measuredAt=now.
 *
 * The multi-axis pipeline (Phase/26 work) handles this case correctly:
 *   • Stage A pre-gate runs symptomOverrideGeneralRule → fires regardless
 *     of whether SBP/DBP are present (the rule guards on session.symptoms,
 *     not BP — see symptom-override.ts).
 *   • Stage B/C never run because no SBP/DBP exist.
 *   • One BP_LEVEL_2_SYMPTOM_OVERRIDE row persists; escalation ladder
 *     dispatches the patient's care team immediately.
 *
 * Pregnancy-only symptoms (newOnsetHeadache, ruqPain, edema) silently
 * become no-ops if the patient isn't pregnant — symptomOverridePregnancyRule
 * gates on isPregnant. We let the rule engine handle that filter rather
 * than duplicating the check here.
 */

import { Injectable, Logger } from '@nestjs/common'
import { DailyJournalService } from '../../daily_journal/daily_journal.service.js'

// Every structured per-reading symptom boolean on JournalEntry that a
// patient could report. Synced 2026-05 so chat/voice symptom-quick-log has
// parity with the check-in checklist + the engine (was stale at the
// original 9). Setting any of these creates a symptom-only entry; the alert
// engine then evaluates whatever rule the flag feeds. Stage-A rules
// (symptom overrides, angioedema) fire on a lone symptom-only entry;
// Stage-C side-effect rules (β-blocker fatigue/SOB, ACE cough) still honor
// their session-averaging / reading-count gates exactly as via check-in.
export type StructuredSymptomKey =
  // Original 9 — Level-2 symptom-override triggers.
  | 'severeHeadache'
  | 'visualChanges'
  | 'alteredMentalStatus'
  | 'chestPainOrDyspnea'
  | 'focalNeuroDeficit'
  | 'severeEpigastricPain'
  | 'newOnsetHeadache'
  | 'ruqPain'
  | 'edema'
  // Cluster 6 (Manisha 5/10/26) — brady-symptomatic / HF-decomp / palpitations.
  | 'dizziness'
  | 'syncope'
  | 'palpitations'
  | 'legSwelling'
  // Cluster 7 (Manisha 5/11/26) — Appendix A side-effects. nsaidUse stays
  // loggable here too (it's a per-reading flag the engine reads).
  | 'fatigue'
  | 'shortnessOfBreath'
  | 'dryCough'
  | 'nsaidUse'
  // Cluster 8 (Manisha 5/18/26, P0) — ACE-angioedema airway emergency.
  | 'faceSwelling'
  | 'throatTightness'

export interface SymptomQuickLogInput {
  symptom: StructuredSymptomKey
  notes?: string
}

export interface SymptomQuickLogResult {
  logged: boolean
  message: string
  symptom: StructuredSymptomKey
  entryId?: string
}

@Injectable()
export class SymptomQuickLogService {
  private readonly logger = new Logger(SymptomQuickLogService.name)

  constructor(private readonly journal: DailyJournalService) {}

  async log(userId: string, input: SymptomQuickLogInput): Promise<SymptomQuickLogResult> {
    // Build a sparse JournalEntry with ONLY the symptom flag set + measuredAt.
    // All other structured booleans default to false; the rule engine reads
    // the OR over all 9 booleans for symptomOverrideGeneralRule.
    const dto: Record<string, unknown> = {
      measuredAt: new Date().toISOString(),
      source: 'CHAT',
      [input.symptom]: true,
      otherSymptoms: input.notes ? [input.notes] : undefined,
    }

    try {
      const result = await this.journal.create(userId, dto as never)
      const entryId = (result as { data?: { id?: string } }).data?.id
      // V-05: the symptom itself is clinical data. entryId resolves it from
      // the access-controlled, audited JournalEntry row.
      this.logger.log(
        `Symptom quick-log for user ${userId}` +
          (entryId ? ` → entry ${entryId}` : ''),
      )
      return {
        logged: true,
        message:
          'Logged. Your care team has been notified — they will review this shortly.',
        symptom: input.symptom,
        entryId,
      }
    } catch (err) {
      this.logger.error(
        `Symptom quick-log failed for user ${userId}: ${(err as Error).message}`,
      )
      return {
        logged: false,
        message:
          'Could not save that. If this is a serious symptom, please call 911 or your provider directly.',
        symptom: input.symptom,
      }
    }
  }
}
