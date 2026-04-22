// Phase/5 contraindication rules — Tier 1, non-dismissable.
// Source: CLINICAL_SPEC Part 7 + §V2-D Tier 1 list.

import { RULE_IDS, type ContextMedication } from '@cardioplace/shared'
import type { RuleFunction } from './types.js'

/**
 * Rule 1 — Pregnancy + ACE/ARB (teratogenic). Fires regardless of BP.
 * Fires on UNVERIFIED meds too (safety-critical; ctx.triggerPregnancyContraindicationCheck
 * is true whenever isPregnant is true — resolver sets it).
 */
export const pregnancyAceArbRule: RuleFunction = (session, ctx) => {
  if (!ctx.triggerPregnancyContraindicationCheck) return null

  const aceOrArbMed = findAceOrArbMedication([...ctx.contextMeds])
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
 */
export const ndhpHfrefRule: RuleFunction = (session, ctx) => {
  if (ctx.profile.resolvedHFType !== 'HFREF') return null

  const ndhpMed = ctx.contextMeds.find((m) => matchesDrugClass(m, 'NDHP_CCB'))
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

function findAceOrArbMedication(
  meds: ContextMedication[],
): ContextMedication | null {
  for (const med of meds) {
    if (matchesDrugClass(med, 'ACE_INHIBITOR') || matchesDrugClass(med, 'ARB')) {
      return med
    }
    // Combo pills register via `combinationComponents` (e.g. Entresto → ARB).
    if (
      matchesCombinationDrugClass(med, 'ACE_INHIBITOR') ||
      matchesCombinationDrugClass(med, 'ARB')
    ) {
      return med
    }
  }
  return null
}

function matchesDrugClass(
  med: ContextMedication,
  target: ContextMedication['drugClass'],
): boolean {
  return med.drugClass === target
}

function matchesCombinationDrugClass(
  med: ContextMedication,
  target: ContextMedication['drugClass'],
): boolean {
  return med.isCombination && med.combinationComponents.includes(target)
}
