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
