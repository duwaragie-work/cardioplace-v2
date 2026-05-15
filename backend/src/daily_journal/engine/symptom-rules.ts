// Cluster 6 — symptom-driven rules introduced with the 4 new patient
// check-in buttons (dizziness / syncope / palpitations / legSwelling).
// HF decompensation + DHP-CCB leg swelling live in condition-branches.ts.
// Brady (absolute + symptomatic) lives in hr-branches.ts. Adherence has its
// own file. This module covers the remaining six rules:
//
//   • orthostaticHypotensionRule    — dizziness + SBP drop ≥15
//   • betaBlockerDizzinessRule      — dizziness + SBP <100 + on β-blocker
//   • afibPalpitationsRule          — palpitations + AFib
//   • tachyPalpitationsRule         — palpitations + HR >100 (no AFib flag)
//   • palpitationsGeneralRule       — palpitations + HR ≤100 (no AFib flag)
//   • syncopeGeneralRule            — syncope + no brady flag (Tier 2 floor)

import { RULE_IDS, getPulsePressure } from '@cardioplace/shared'
import type { RuleFunction, RuleResult } from './types.js'

const ORTHOSTATIC_SBP_DROP = 15
const BETA_BLOCKER_LOW_SBP = 100
const TACHY_HR = 100

// ── orthostaticHypotensionRule ──────────────────────────────────────────────

export const orthostaticHypotensionRule: RuleFunction = (session) => {
  if (!session.symptoms.dizziness) return null
  if (session.systolicBP == null) return null
  const prior = session.priorSystolicBP
  if (prior == null) return null
  const drop = prior - session.systolicBP
  if (drop < ORTHOSTATIC_SBP_DROP) return null

  return buildResult(
    RULE_IDS.ORTHOSTATIC_HYPOTENSION,
    'BP_LEVEL_1_LOW',
    session,
    `Orthostatic SBP drop ${drop} mmHg (prior ${prior} → ${session.systolicBP}) + dizziness.`,
    'Orthostatic hypotension',
  )
}

// ── betaBlockerDizzinessRule ────────────────────────────────────────────────

export const betaBlockerDizzinessRule: RuleFunction = (session, ctx) => {
  if (!session.symptoms.dizziness) return null
  if (session.systolicBP == null || session.systolicBP >= BETA_BLOCKER_LOW_SBP) return null
  const onBetaBlocker = ctx.contextMeds.some((m) => m.drugClass === 'BETA_BLOCKER')
  if (!onBetaBlocker) return null

  return buildResult(
    RULE_IDS.BETA_BLOCKER_DIZZINESS,
    'TIER_3_INFO',
    session,
    `Dizziness + SBP ${session.systolicBP} <${BETA_BLOCKER_LOW_SBP} on β-blocker — possible drug-induced hypotension.`,
    'β-blocker hypotension side-effect',
  )
}

// ── afibPalpitationsRule ────────────────────────────────────────────────────

export const afibPalpitationsRule: RuleFunction = (session, ctx) => {
  if (!session.symptoms.palpitations) return null
  if (!ctx.profile.hasAFib) return null

  return buildResult(
    RULE_IDS.AFIB_PALPITATIONS,
    'BP_LEVEL_1_LOW',
    session,
    'Palpitations reported in AFib patient — possible paroxysmal recurrence.',
    'AFib palpitations',
  )
}

// ── tachyPalpitationsRule ───────────────────────────────────────────────────

export const tachyPalpitationsRule: RuleFunction = (session, ctx) => {
  if (!session.symptoms.palpitations) return null
  if (ctx.profile.hasAFib) return null
  if (session.pulse == null || session.pulse <= TACHY_HR) return null

  return buildResult(
    RULE_IDS.TACHY_WITH_PALPITATIONS,
    'BP_LEVEL_1_HIGH',
    session,
    `Palpitations + HR ${session.pulse} >${TACHY_HR} — symptomatic tachycardia.`,
    'Tachycardia with palpitations',
  )
}

// ── palpitationsGeneralRule ─────────────────────────────────────────────────

export const palpitationsGeneralRule: RuleFunction = (session, ctx) => {
  if (!session.symptoms.palpitations) return null
  if (ctx.profile.hasAFib) return null
  // Already covered by tachy branch when HR > 100.
  if (session.pulse != null && session.pulse > TACHY_HR) return null

  return buildResult(
    RULE_IDS.PALPITATIONS_GENERAL,
    'TIER_3_INFO',
    session,
    `Palpitations reported with HR ${session.pulse ?? '?'} ≤${TACHY_HR} — consider monitor.`,
    'Palpitations (no AFib, normal rate)',
  )
}

// ── syncopeGeneralRule ──────────────────────────────────────────────────────
// Brady patients already covered by bradySymptomaticRule (HR<50 + syncope) +
// bradyAbsoluteRule (HR<40). This rule catches the "fainted but no brady
// flag" case — Manisha says syncope is always at least Tier 2.

export const syncopeGeneralRule: RuleFunction = (session, ctx) => {
  if (!session.symptoms.syncope) return null
  if (ctx.profile.hasBradycardia) return null
  // Defer to brady rules when patient is mid-brady right now.
  if (session.pulse != null && session.pulse < 50) return null

  return buildResult(
    RULE_IDS.SYNCOPE_GENERAL,
    'BP_LEVEL_1_LOW',
    session,
    'Syncope / near-syncope reported — provider review for cardiac vs vasovagal etiology.',
    'Syncope (no brady flag)',
  )
}

// ─── Cluster 7 (Manisha 5/11/26) — Appendix A side-effect + interaction rules ──
//
// Each rule below mirrors the Cluster 6 pattern: gate on a per-reading
// symptom flag + medication or condition context, return TIER_3_INFO so the
// row persists as patient-facing info without triggering an escalation
// ladder (per EscalationService.fireT0 which excludes TIER_3). The HF
// variant of β-blocker SOB is the exception — it escalates as Tier 2.

const ANTIHYPERTENSIVE_CLASSES = new Set([
  'ACE_INHIBITOR',
  'ARB',
  'BETA_BLOCKER',
  'DHP_CCB',
  'NDHP_CCB',
  'LOOP_DIURETIC',
  'THIAZIDE',
  'MRA',
  'ARNI',
])

// ── A.1 betaBlockerFatigueRule (Appendix A.2) ──────────────────────────────
// Patient on any β-blocker reports fatigue → patient-facing side-effect.
// Common, expected effect; clinical action is dose-review, not escalation.

export const betaBlockerFatigueRule: RuleFunction = (session, ctx) => {
  if (!session.symptoms.fatigue) return null
  const onBetaBlocker = ctx.contextMeds.some((m) => m.drugClass === 'BETA_BLOCKER')
  if (!onBetaBlocker) return null

  return buildResult(
    RULE_IDS.BETA_BLOCKER_FATIGUE,
    'TIER_3_INFO',
    session,
    'Fatigue reported on β-blocker — common dose-dependent side effect.',
    'β-blocker fatigue',
  )
}

// ── A.2 betaBlockerSobHfRule (Appendix A.3 — HF variant) ──────────────────
// Patient on β-blocker + hasHeartFailure flag + reports shortness of
// breath → Tier 2 alert that escalates. New SOB in HF is decompensation
// risk regardless of BP — provider gets a row, not the patient.

export const betaBlockerSobHfRule: RuleFunction = (session, ctx) => {
  if (!session.symptoms.shortnessOfBreath) return null
  const hasHf =
    ctx.profile.hasHeartFailure ||
    ctx.profile.resolvedHFType === 'HFREF' ||
    ctx.profile.resolvedHFType === 'HFPEF'
  if (!hasHf) return null
  const onBetaBlocker = ctx.contextMeds.some((m) => m.drugClass === 'BETA_BLOCKER')
  if (!onBetaBlocker) return null

  return buildResult(
    RULE_IDS.BETA_BLOCKER_SOB_HF,
    'TIER_2_DISCREPANCY',
    session,
    'Shortness of breath reported on β-blocker in HF patient — possible decompensation.',
    'β-blocker SOB in HF',
  )
}

// ── A.2 betaBlockerSobNonHfRule (Appendix A.3 — non-HF variant) ──────────
// Same symptom + med, no HF flag → patient-facing side-effect only.

export const betaBlockerSobNonHfRule: RuleFunction = (session, ctx) => {
  if (!session.symptoms.shortnessOfBreath) return null
  const hasHf =
    ctx.profile.hasHeartFailure ||
    ctx.profile.resolvedHFType === 'HFREF' ||
    ctx.profile.resolvedHFType === 'HFPEF'
  if (hasHf) return null
  const onBetaBlocker = ctx.contextMeds.some((m) => m.drugClass === 'BETA_BLOCKER')
  if (!onBetaBlocker) return null

  return buildResult(
    RULE_IDS.BETA_BLOCKER_SOB_NON_HF,
    'TIER_3_INFO',
    session,
    'Shortness of breath reported on β-blocker (non-HF) — possible bronchospasm or exercise intolerance side-effect.',
    'β-blocker SOB side-effect',
  )
}

// ── A.3 nsaidAntihypertensiveRule (Appendix A.5) ──────────────────────────
// NSAID use (per-reading flag OR chronic NSAID in med list) + any
// antihypertensive → patient warning. NSAIDs blunt antihypertensive
// efficacy + drive sodium retention.

export const nsaidAntihypertensiveRule: RuleFunction = (session, ctx) => {
  const nsaidThisReading = session.symptoms.nsaidUse
  const nsaidInMedList = ctx.contextMeds.some((m) => m.drugClass === 'NSAID')
  if (!nsaidThisReading && !nsaidInMedList) return null

  const onAntihtn = ctx.contextMeds.some((m) => ANTIHYPERTENSIVE_CLASSES.has(m.drugClass))
  if (!onAntihtn) return null

  return buildResult(
    RULE_IDS.NSAID_ANTIHTN_INTERACTION,
    'TIER_3_INFO',
    session,
    'NSAID use reported alongside antihypertensive therapy — may blunt BP control.',
    'NSAID + antihypertensive interaction',
  )
}

// ── A.4 aceCoughRule (Appendix A.6 + B1.3) ────────────────────────────────
// Patient on ACE inhibitor reports dry cough → patient-facing side-effect.
// Bradykinin-mediated; usually resolves with ARB switch.

export const aceCoughRule: RuleFunction = (session, ctx) => {
  if (!session.symptoms.dryCough) return null
  const onAce = ctx.contextMeds.some((m) => m.drugClass === 'ACE_INHIBITOR')
  if (!onAce) return null

  return buildResult(
    RULE_IDS.ACE_COUGH,
    'TIER_3_INFO',
    session,
    'Dry cough reported on ACE inhibitor — classic bradykinin side-effect.',
    'ACE inhibitor cough',
  )
}

// ── A.6 hfCaregiverEdemaRule (Appendix B1.5) ──────────────────────────────
// HF patient + new ankle swelling → caregiver-routed message. Sits on its
// own axis so it coexists with hfDecompensationRule (which is the Tier 2
// physician escalation on the same trigger). Dispatch path is feature-
// flagged behind CAREGIVER_DISPATCH_ENABLED — see escalation.service.ts.

export const hfCaregiverEdemaRule: RuleFunction = (session, ctx) => {
  if (!session.symptoms.legSwelling) return null
  const hasHf =
    ctx.profile.hasHeartFailure ||
    ctx.profile.resolvedHFType === 'HFREF' ||
    ctx.profile.resolvedHFType === 'HFPEF'
  if (!hasHf) return null

  return buildResult(
    RULE_IDS.HF_CAREGIVER_EDEMA,
    'TIER_3_INFO',
    session,
    'Ankle swelling in HF patient — caregiver should monitor weight + escalation per care plan.',
    'HF caregiver edema watch',
  )
}

// ── shared helper ───────────────────────────────────────────────────────────

function buildResult(
  ruleId: RuleResult['ruleId'],
  tier: RuleResult['tier'],
  session: Parameters<RuleFunction>[0],
  reason: string,
  conditionLabel: string,
): RuleResult {
  return {
    ruleId,
    tier,
    mode: 'STANDARD',
    pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: session.systolicBP,
    reason,
    metadata: { conditionLabel },
  }
}
