import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import {
  ALL_RULE_IDS,
  alertMessageRegistry,
  type AlertContext,
  type RuleId,
} from '@cardioplace/shared'
import type { RuleResult, SessionAverage } from '../engine/types.js'

/**
 * Phase/6 OutputGenerator — single consumer of the shared alert-messages
 * registry. The orchestrator (AlertEngine) calls `generate()` after a rule
 * fires; the returned trio lands on DeviationAlert.{patient,caregiver,physician}Message.
 *
 * Startup contract: `onModuleInit()` verifies every `RuleId` in
 * ALL_RULE_IDS has a registry entry. If any rule is missing its messages,
 * the backend refuses to boot — this keeps the contract tight as new rules
 * are added in future phases.
 */
@Injectable()
export class OutputGeneratorService implements OnModuleInit {
  private readonly logger = new Logger(OutputGeneratorService.name)

  onModuleInit(): void {
    const missing: RuleId[] = []
    for (const ruleId of ALL_RULE_IDS) {
      const entry = alertMessageRegistry[ruleId]
      if (
        !entry ||
        typeof entry.patientMessage !== 'function' ||
        typeof entry.caregiverMessage !== 'function' ||
        typeof entry.physicianMessage !== 'function'
      ) {
        missing.push(ruleId)
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `OutputGeneratorService: alertMessageRegistry is missing entries for rule(s): ${missing.join(
          ', ',
        )}. Add them to shared/src/alert-messages.ts before booting.`,
      )
    }
    this.logger.log(
      `alertMessageRegistry verified: ${ALL_RULE_IDS.length} rules, all 3 tiers populated.`,
    )
  }

  generate(
    result: RuleResult,
    session: SessionAverage,
    preDay3: boolean,
    patientName: string | null = null,
    dateOfBirth: Date | null = null,
    contextMeds: ReadonlyArray<{ drugName: string; drugClass: string }> = [],
  ): {
    patientMessage: string
    caregiverMessage: string
    physicianMessage: string
  } {
    const entry = alertMessageRegistry[result.ruleId]
    // Physician message keeps the session-averaged BP (the engine's evaluation
    // truth). F7 — patient/caregiver messages cite the just-submitted reading so
    // the body matches the "Recorded" header the patient saw, instead of an
    // averaged value they never entered.
    const physicianCtx = this.buildContext(
      result,
      session,
      preDay3,
      patientName,
      dateOfBirth,
      contextMeds,
    )
    const patientCtx: AlertContext = {
      ...physicianCtx,
      systolicBP: session.submittedSystolicBP ?? physicianCtx.systolicBP,
      diastolicBP: session.submittedDiastolicBP ?? physicianCtx.diastolicBP,
    }
    return {
      patientMessage: entry.patientMessage(patientCtx),
      caregiverMessage: entry.caregiverMessage(patientCtx),
      physicianMessage: entry.physicianMessage(physicianCtx),
    }
  }

  private buildContext(
    result: RuleResult,
    session: SessionAverage,
    preDay3: boolean,
    patientName: string | null = null,
    dateOfBirth: Date | null = null,
    contextMeds: ReadonlyArray<{ drugName: string; drugClass: string }> = [],
  ): AlertContext {
    // Default `drugNames` from rule metadata; fall back to a single-element
    // array of `drugName` so legacy single-drug rules still satisfy the
    // non-optional shape on AlertContext.
    const drugNames =
      result.metadata.drugNames && result.metadata.drugNames.length > 0
        ? result.metadata.drugNames
        : result.metadata.drugName
          ? [result.metadata.drugName]
          : []

    return {
      // #83 — scopes the single-reading caveat to BP/HR rules in physSuffix.
      ruleId: result.ruleId,
      systolicBP: session.systolicBP,
      diastolicBP: session.diastolicBP,
      pulse: session.pulse,
      pulsePressure: result.pulsePressure,
      drugName: result.metadata.drugName ?? null,
      drugNames,
      drugClass: result.metadata.drugClass ?? null,
      conditionLabel: result.metadata.conditionLabel ?? null,
      thresholdValue: result.metadata.thresholdValue ?? null,
      physicianAnnotations: result.metadata.physicianAnnotations ?? [],
      preDay3,
      suboptimalMeasurement: result.suboptimalMeasurement,
      // Surface per-medication miss detail for RULE_MEDICATION_MISSED messages.
      // Strip medicationId (internal) and narrow reason to the union the
      // message registry expects.
      missedMedications: result.metadata.missedMedications?.map((m) => ({
        drugName: m.drugName,
        drugClass: m.drugClass,
        reason: m.reason,
        missedDoses: m.missedDoses,
      })),
      // Cluster 6 — adherence template inputs ("X of 3 days" wording +
      // beta-blocker carve-out variant). Populated only by RULE_MEDICATION_MISSED.
      adherenceDaysWithMiss: result.metadata.adherenceDaysWithMiss,
      adherenceDaysWithMissOver7d: result.metadata.adherenceDaysWithMissOver7d,
      adherenceBetaBlockerCarveOut: result.metadata.adherenceBetaBlockerCarveOut,
      // Cluster 8 — which angioedema symptom(s) fired. Lets the message
      // builders lead with throat-tightness vs face-swelling wording.
      angioedemaFace: result.metadata.angioedemaFace,
      angioedemaThroat: result.metadata.angioedemaThroat,
      // Cluster 8 Q1 — consecutive ≤45 bpm sessions for the brady-
      // surveillance physician message Tier 3 → Tier 2 wording.
      bradySustainedSessions: result.metadata.bradySustainedSessions,
      // Manisha Open-Decisions sign-off 2026-06-06 (Decision 4, conditional
      // exception) — gestational age in completed weeks for pregnancy
      // physician messages. Populated by pregnancy threshold + ACE/ARB
      // contraindication rules from PatientProfile.pregnancyDueDate;
      // remains null/undefined for non-pregnancy alerts.
      gestationalAgeWeeks: result.metadata.gestationalAgeWeeks,
      // Manisha Open-Decisions sign-off 2026-06-06 (Decision 4) — patient age
      // in completed years for rules where age modifies clinical significance.
      // Issue #68 — plumbing only; rule message edits await Manisha wording
      // confirmation. Computed centrally here (vs in each rule) so all rules
      // can opt in by inlining `agePhrase(ctx)` once message wording lands.
      patientAgeYears: ageFromDob(dateOfBirth, session.measuredAt),
      // Manisha Open-Decisions sign-off 2026-06-06 (Decision 4) — patient's
      // other active medications, EXCLUDING the triggering drug(s) already
      // named via `drugNames`. Issue #69 — plumbing only; rule message edits
      // await Manisha wording confirmation. Dedup happens here so the helper
      // `medicationListPhrase(ctx)` doesn't have to know which meds were
      // already cited inline.
      activeMedications: dedupeActiveMeds(contextMeds, drugNames),
      // Cluster 6 Q2 (Manisha 5/9/26) — true when alert fired on a single-
      // reading session finalized by the 5-min timeout. Drives the
      // "— confirm with next reading" physician-message annotation.
      singleReadingSession:
        session.singleReadingFinalized && session.readingCount < 2,
      // Gap 5 — name the patient in caregiver-facing message templates.
      patientName,
    }
  }
}

/**
 * Issue #68 — compute completed years between DOB and a reference date.
 * Mirrors the `ageFromDob` helper in `escalation.service.ts` (which renders
 * the email patient-identifier block) so both surfaces use the same value
 * for the same alert. Returns null when DOB is missing, future, or the
 * derived age is implausible (>130).
 *
 * Anchored on `session.measuredAt` so the value is deterministic in tests
 * and consistent with the gestational-age pattern (same anchor used by
 * `gestationalAgeWeeksFromProfile`).
 */
function ageFromDob(dob: Date | null, now: Date): number | null {
  if (!dob) return null
  const ms = now.getTime() - dob.getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const years = Math.floor(ms / (365.2425 * 24 * 60 * 60 * 1000))
  if (years < 0 || years > 130) return null
  return years
}

/**
 * Issue #69 — strip any drug already named via the rule's `drugNames` (case-
 * insensitive) so the rendered "Currently also taking: …" list never
 * duplicates a drug the message already cites inline. Returns
 * `Array<{drugName, drugClass}>` shaped for the `AlertContext` field
 * (lighter than `ContextMedication`, which carries verification status,
 * combo flags, etc., that the wording doesn't need).
 *
 * Stable order: preserved from input. Empty array when every active med
 * matches the triggering set OR the input was already empty.
 */
function dedupeActiveMeds(
  contextMeds: ReadonlyArray<{ drugName: string; drugClass: string }>,
  triggerDrugNames: string[],
): Array<{ drugName: string; drugClass: string }> {
  if (contextMeds.length === 0) return []
  const triggerSet = new Set(
    triggerDrugNames.map((n) => n.trim().toLowerCase()).filter(Boolean),
  )
  return contextMeds
    .filter((m) => m.drugName && !triggerSet.has(m.drugName.trim().toLowerCase()))
    .map((m) => ({ drugName: m.drugName, drugClass: m.drugClass }))
}
