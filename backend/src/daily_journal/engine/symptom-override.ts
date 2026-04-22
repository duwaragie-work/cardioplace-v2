// Phase/5 symptom-override rules — trigger BP Level 2 at any BP.
// Source: CLINICAL_SPEC Part 1.3 + Part 3 (pregnancy).

import { RULE_IDS } from '@cardioplace/shared'
import type { RuleFunction } from './types.js'
import { getPulsePressure } from '@cardioplace/shared'

/**
 * Rule 3a — General symptom override. Any of the six structured
 * target-organ-damage symptoms fires Level 2 at any BP.
 */
export const symptomOverrideGeneralRule: RuleFunction = (session, ctx) => {
  const s = session.symptoms
  const anyGeneral =
    s.severeHeadache ||
    s.visualChanges ||
    s.alteredMentalStatus ||
    s.chestPainOrDyspnea ||
    s.focalNeuroDeficit ||
    s.severeEpigastricPain
  if (!anyGeneral) return null

  const pp = getPulsePressure(session.systolicBP, session.diastolicBP)

  return {
    ruleId: RULE_IDS.SYMPTOM_OVERRIDE_GENERAL,
    tier: 'BP_LEVEL_2_SYMPTOM_OVERRIDE',
    mode: 'STANDARD',
    pulsePressure: pp,
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: session.systolicBP,
    reason: 'Target-organ-damage symptom reported — BP Level 2.',
    metadata: {
      conditionLabel: activeGeneralSymptoms(s).join(', '),
    },
  }
}

/**
 * Rule 3b — Pregnancy-specific symptom override (preeclampsia features).
 * Only fires when isPregnant; the three flags (newOnsetHeadache, ruqPain,
 * edema) are meaningful symptom triggers only in that context.
 */
export const symptomOverridePregnancyRule: RuleFunction = (session, ctx) => {
  if (!ctx.pregnancyThresholdsActive) return null
  const s = session.symptoms
  const anyPregnancy = s.newOnsetHeadache || s.ruqPain || s.edema
  if (!anyPregnancy) return null

  const pp = getPulsePressure(session.systolicBP, session.diastolicBP)

  return {
    ruleId: RULE_IDS.SYMPTOM_OVERRIDE_PREGNANCY,
    tier: 'BP_LEVEL_2_SYMPTOM_OVERRIDE',
    mode: 'STANDARD',
    pulsePressure: pp,
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: session.systolicBP,
    reason: 'Preeclampsia-feature symptom reported — BP Level 2.',
    metadata: {
      conditionLabel: activePregnancySymptoms(s).join(', '),
    },
  }
}

function activeGeneralSymptoms(s: {
  severeHeadache: boolean
  visualChanges: boolean
  alteredMentalStatus: boolean
  chestPainOrDyspnea: boolean
  focalNeuroDeficit: boolean
  severeEpigastricPain: boolean
}): string[] {
  const out: string[] = []
  if (s.severeHeadache) out.push('severe headache')
  if (s.visualChanges) out.push('visual changes')
  if (s.alteredMentalStatus) out.push('altered mental status')
  if (s.chestPainOrDyspnea) out.push('chest pain or dyspnea')
  if (s.focalNeuroDeficit) out.push('focal neuro deficit')
  if (s.severeEpigastricPain) out.push('severe epigastric pain')
  return out
}

function activePregnancySymptoms(s: {
  newOnsetHeadache: boolean
  ruqPain: boolean
  edema: boolean
}): string[] {
  const out: string[] = []
  if (s.newOnsetHeadache) out.push('new-onset headache')
  if (s.ruqPain) out.push('RUQ pain')
  if (s.edema) out.push('edema')
  return out
}
