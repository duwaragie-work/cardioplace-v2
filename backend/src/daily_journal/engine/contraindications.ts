// Phase/5 contraindication rules — Tier 1, non-dismissable.
// Source: CLINICAL_SPEC Part 7 + §V2-D Tier 1 list.

import { RULE_IDS, type ContextMedication, type DrugClassInput } from '@cardioplace/shared'
import type { RuleFunction } from './types.js'

/**
 * Rule 1 — Pregnancy + ACE/ARB (teratogenic). Fires regardless of BP.
 * Fires on UNVERIFIED meds too (safety-critical; ctx.triggerPregnancyContraindicationCheck
 * is true whenever isPregnant is true — resolver sets it).
 */
export const pregnancyAceArbRule: RuleFunction = (session, ctx) => {
  if (!ctx.triggerPregnancyContraindicationCheck) return null

  const aceOrArbMed =
    findMedWithDrugClass(ctx.contextMeds, 'ACE_INHIBITOR') ??
    findMedWithDrugClass(ctx.contextMeds, 'ARB')
  if (!aceOrArbMed) return null

  return {
    ruleId: RULE_IDS.PREGNANCY_ACE_ARB,
    tier: 'TIER_1_CONTRAINDICATION',
    mode: 'STANDARD',
    pulsePressure: null,
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: null,
    reason: `ACE/ARB (${aceOrArbMed.drugName}) in pregnant patient — teratogenic.`,
    metadata: {
      drugName: aceOrArbMed.drugName,
      drugClass: aceOrArbMed.drugClass,
      conditionLabel: 'Pregnancy',
    },
  }
}

/**
 * Rule 2 — Nondihydropyridine CCB + HFrEF (negative inotropic, harmful).
 * Uses resolvedHFType so UNKNOWN + DCM are both treated as HFrEF.
 *
 * Checks both primary drugClass and combo components (Bug 5 fix — mirrors the
 * pregnancy+ACE/ARB path). No combo in the current catalog registers as
 * NDHP_CCB, so this has no behavioral change today but closes a future
 * regression path if a combo NDHP med is added.
 */
export const ndhpHfrefRule: RuleFunction = (session, ctx) => {
  if (ctx.profile.resolvedHFType !== 'HFREF') return null

  const ndhpMed = findMedWithDrugClass(ctx.contextMeds, 'NDHP_CCB')
  if (!ndhpMed) return null

  // Only fire for verified NDHP meds. Safety-net limits Tier 1 on unverified
  // meds to the pregnancy+ACE/ARB pair (CLINICAL_SPEC §V2-A Step 3).
  if (ndhpMed.verificationStatus !== 'VERIFIED') return null

  return {
    ruleId: RULE_IDS.NDHP_HFREF,
    tier: 'TIER_1_CONTRAINDICATION',
    mode: 'STANDARD',
    pulsePressure: null,
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: null,
    reason: `NDHP-CCB (${ndhpMed.drugName}) in HFrEF — harmful.`,
    metadata: {
      drugName: ndhpMed.drugName,
      drugClass: ndhpMed.drugClass,
      conditionLabel: 'HFrEF',
    },
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Returns the first medication whose primary drugClass matches, OR whose
 * combinationComponents include the target. Exported so tests can exercise it
 * directly.
 */
export function findMedWithDrugClass(
  meds: ContextMedication[],
  target: DrugClassInput,
): ContextMedication | null {
  for (const med of meds) {
    if (med.drugClass === target) return med
    if (med.isCombination && med.combinationComponents.includes(target)) return med
  }
  return null
}
