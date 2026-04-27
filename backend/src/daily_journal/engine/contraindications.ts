// Phase/5 contraindication rules — Tier 1, non-dismissable.
// Source: CLINICAL_SPEC Part 7 + §V2-D Tier 1 list.

import { RULE_IDS, type ContextMedication, type DrugClassInput } from '@cardioplace/shared'
import type { RuleFunction } from './types.js'

/**
 * Rule 1 — Pregnancy + ACE/ARB (teratogenic). Fires regardless of BP.
 * Fires on UNVERIFIED meds too (safety-critical; ctx.triggerPregnancyContraindicationCheck
 * is true whenever isPregnant is true — resolver sets it).
 *
 * Bug fix — collect ALL ACE/ARB meds the patient is on, not just the first.
 * A pregnant patient on Prinivil + Zestoretic must hear both names; naming
 * one and silently dropping the other risks the patient discontinuing the
 * named drug while continuing the unnamed one. `metadata.drugName` keeps
 * the first match for back-compat; `metadata.drugNames` is the full list
 * the OutputGenerator joins for the physician message.
 */
export const pregnancyAceArbRule: RuleFunction = (session, ctx) => {
  if (!ctx.triggerPregnancyContraindicationCheck) return null

  const matched = [
    ...findAllMedsWithDrugClass(ctx.contextMeds, 'ACE_INHIBITOR'),
    ...findAllMedsWithDrugClass(ctx.contextMeds, 'ARB'),
  ]
  if (matched.length === 0) return null

  // Dedup by id in case a combo med flagged on both ACE and ARB (rare).
  const seen = new Set<string>()
  const unique = matched.filter((m) => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })

  const drugNames = unique.map((m) => m.drugName)
  const reason =
    unique.length === 1
      ? `ACE/ARB (${unique[0].drugName}) in pregnant patient — teratogenic.`
      : `ACE/ARB (${drugNames.join(', ')}) in pregnant patient — teratogenic.`

  return {
    ruleId: RULE_IDS.PREGNANCY_ACE_ARB,
    tier: 'TIER_1_CONTRAINDICATION',
    mode: 'STANDARD',
    pulsePressure: null,
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: null,
    reason,
    metadata: {
      drugName: unique[0].drugName,
      drugClass: unique[0].drugClass,
      drugNames,
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

/**
 * Returns ALL medications whose primary drugClass matches OR whose combo
 * components include the target. Used by the pregnancy rule so the alert
 * names every offending drug instead of stopping at the first match.
 */
export function findAllMedsWithDrugClass(
  meds: ContextMedication[],
  target: DrugClassInput,
): ContextMedication[] {
  const out: ContextMedication[] = []
  for (const med of meds) {
    if (med.drugClass === target) {
      out.push(med)
      continue
    }
    if (med.isCombination && med.combinationComponents.includes(target)) {
      out.push(med)
    }
  }
  return out
}
