/**
 * Phase/27 chatbot v2 — quick medication adherence logging.
 *
 * Powers the `log_medication_adherence` tool: patient says "I took my
 * Lisinopril this morning" and the bot calls this without forcing a full
 * check-in dance. Persists a sparse JournalEntry via DailyJournalService
 * so the rule engine's adherence pass (Pass 2) sees it like any other entry.
 *
 * Design rules:
 *   • taken           → medicationTaken=true,  no missedMedications
 *   • missed          → medicationTaken=false, missedMedications=[detail]
 *                       → fires RULE_MEDICATION_MISSED
 *   • scheduled_later → medicationScheduledLater=true, medicationTaken
 *                       intentionally undefined → adherence rule skips it
 *
 * The "scheduled_later" semantics match the comment in
 * create-journal-entry.dto.ts:131-139: rule fires only when
 * medicationTaken === false explicitly, so an undefined value with the
 * scheduled-later flag is silently ignored. This is the intended behaviour
 * for "not due yet" — neither taken nor missed.
 */

import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service.js'
import { DailyJournalService } from '../../daily_journal/daily_journal.service.js'

export type AdherenceStatus = 'taken' | 'missed' | 'scheduled_later'

export interface AdherenceLogInput {
  /** Either medicationId OR drugName must be provided. medicationId wins
   *  when both are sent. */
  medicationId?: string
  drugName?: string
  status: AdherenceStatus
  /** Required when status='missed' to populate the rule engine's payload. */
  missedDoses?: number
  reason?: string
}

export interface AdherenceLogResult {
  logged: boolean
  message: string
  /** Echoes the medication that was matched so the chat card can render it. */
  medication: { id: string; drugName: string; drugClass: string } | null
  status: AdherenceStatus
  entryId?: string
}

@Injectable()
export class MedicationAdherenceService {
  private readonly logger = new Logger(MedicationAdherenceService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: DailyJournalService,
  ) {}

  async log(userId: string, input: AdherenceLogInput): Promise<AdherenceLogResult> {
    if (!input.medicationId && !input.drugName) {
      return {
        logged: false,
        message: 'Please tell me which medication you mean.',
        medication: null,
        status: input.status,
      }
    }

    // Resolve medication. Match by id first; then by case-insensitive drugName
    // among the patient's active medications. Ambiguous matches (e.g., two
    // active Lisinopril rows from different prescribers) take the most-recent
    // one — the chat card surfaces the resolved drug for the patient to
    // verify.
    const med = await this.findActiveMedication(userId, input)
    if (!med) {
      return {
        logged: false,
        message: input.drugName
          ? `Could not find an active medication named "${input.drugName}" in your list. Tell me which one you mean.`
          : 'Could not find that medication in your active list.',
        medication: null,
        status: input.status,
      }
    }

    // Build sparse JournalEntry. measuredAt = now (this is a real-time
    // adherence log, not a backdated reading). No SBP/DBP/pulse — adherence
    // pass is independent of BP rules per alert-engine.service.ts:142-160.
    const dto: Record<string, unknown> = {
      measuredAt: new Date().toISOString(),
      source: 'CHAT',
    }

    switch (input.status) {
      case 'taken':
        dto.medicationTaken = true
        break
      case 'missed':
        dto.medicationTaken = false
        dto.missedDoses = input.missedDoses && input.missedDoses > 0 ? input.missedDoses : 1
        dto.missedMedications = [{
          medicationId: med.id,
          drugName: med.drugName,
          drugClass: med.drugClass,
          reason: input.reason ?? 'OTHER',
          missedDoses: dto.missedDoses,
        }]
        break
      case 'scheduled_later':
        // Leave medicationTaken intentionally undefined so the adherence rule
        // skips this entry. Flag the entry as scheduled-later so the chat
        // card + dashboard can surface it without alerting.
        dto.medicationScheduledLater = true
        break
    }

    try {
      const result = await this.journal.create(userId, dto as never)
      const entryId = (result as { data?: { id?: string } }).data?.id
      // V-05: "user X takes drug Y" is PHI (a medication implies a condition).
      // medId + entryId let ops resolve it from the access-controlled DB.
      this.logger.log(
        `Adherence logged for user ${userId} medId=${med.id}` +
          (entryId ? ` → entry ${entryId}` : ''),
      )
      return {
        logged: true,
        message: this.successMessage(med.drugName, input.status),
        medication: { id: med.id, drugName: med.drugName, drugClass: med.drugClass },
        status: input.status,
        entryId,
      }
    } catch (err) {
      this.logger.error(
        `Adherence log failed for user ${userId}: ${(err as Error).message}`,
      )
      return {
        logged: false,
        message: 'Could not save that. Please try again.',
        medication: { id: med.id, drugName: med.drugName, drugClass: med.drugClass },
        status: input.status,
      }
    }
  }

  /**
   * Find an active medication for this patient. Prefers exact id match;
   * falls back to a case-insensitive drugName match on the latest active row.
   * Returns null when the patient doesn't own that medication.
   */
  private async findActiveMedication(
    userId: string,
    input: AdherenceLogInput,
  ): Promise<{ id: string; drugName: string; drugClass: string } | null> {
    if (input.medicationId) {
      const byId = await this.prisma.patientMedication.findFirst({
        where: { id: input.medicationId, userId, discontinuedAt: null },
        select: { id: true, drugName: true, drugClass: true },
      })
      if (byId) return byId
      // Composite WHERE missed — either the id doesn't exist OR it belongs to
      // a different patient. Log for ops (cross-tenant probe / LLM-
      // hallucinated UUID detection) and refuse to fall through to drugName.
      this.logger.warn(
        `[SECURITY] cross_tenant_attempt service=adherence action=findByMedicationId userId=${userId} requestedId=${input.medicationId}`,
      )
      return null
    }
    if (!input.drugName) return null
    const trimmed = input.drugName.trim()
    if (!trimmed) return null

    // Case-insensitive contains match — patient says "Lisinopril 10mg" but
    // the row is just "Lisinopril".
    const matches = await this.prisma.patientMedication.findMany({
      where: {
        userId,
        discontinuedAt: null,
        drugName: { contains: trimmed, mode: 'insensitive' },
      },
      orderBy: { reportedAt: 'desc' },
      take: 1,
      select: { id: true, drugName: true, drugClass: true },
    })
    return matches[0] ?? null
  }

  private successMessage(drugName: string, status: AdherenceStatus): string {
    switch (status) {
      case 'taken':
        return `Logged: ${drugName} taken.`
      case 'missed':
        return `Logged: ${drugName} missed.`
      case 'scheduled_later':
        return `Noted: ${drugName} is not due yet.`
    }
  }
}
