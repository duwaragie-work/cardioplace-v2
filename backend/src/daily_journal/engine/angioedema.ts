// Cluster 8 (Manisha 5/18/26) — ACE-angioedema airway emergency.
// Source: cardioplace-ace-angioedema-rule-signoff (P0 pilot blocker).
//
// Fires on faceSwelling OR throatTightness for ALL patients regardless of
// medication profile — sudden facial/lip/tongue swelling or throat tightness
// is a potential airway emergency whatever the cause (ACE/ARB, NSAID,
// hereditary C1 deficiency, allergic, idiopathic). Three-branch ruleId +
// physician-message split:
//
//   Branch 1  ACE inhibitor on med list  → RULE_ACE_ANGIOEDEMA (ACE variant)
//   Branch 2  ARB on med list, no ACE     → RULE_ACE_ANGIOEDEMA (ARB variant)
//   Branch 3  neither                     → RULE_GENERIC_ANGIOEDEMA
//   Edge      no ACE/ARB but list has an unverified med → GENERIC + provider
//             note ("cannot rule out ACE/ARB exposure")
//
// Tier TIER_1_ANGIOEDEMA — non-dismissable, routed to the compressed
// escalation ladder (T+0 → T+15m → T+1h → T+4h). NO time-based filter on
// ACE-inhibitor duration: angioedema can occur after years of therapy
// (doc Q4, OCTAVE trial).

import { RULE_IDS, getPulsePressure } from '@cardioplace/shared'
import type { RuleFunction } from './types.js'

export const angioedemaRule: RuleFunction = (session, ctx) => {
  const s = session.symptoms
  if (!s.faceSwelling && !s.throatTightness) return null

  const ace = ctx.contextMeds.find((m) => m.drugClass === 'ACE_INHIBITOR')
  const arb = ctx.contextMeds.find((m) => m.drugClass === 'ARB')
  const med = ace ?? arb
  const onAceOrArb = med != null

  // Edge case — no ACE/ARB matched but the list isn't fully verified, so we
  // cannot clinically rule out exposure. Generic rule + provider note.
  const unverifiedList =
    !onAceOrArb &&
    ctx.contextMeds.some((m) => m.verificationStatus !== 'VERIFIED')

  return {
    ruleId: onAceOrArb
      ? RULE_IDS.ACE_ANGIOEDEMA
      : RULE_IDS.GENERIC_ANGIOEDEMA,
    tier: 'TIER_1_ANGIOEDEMA',
    mode: 'STANDARD',
    pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: session.systolicBP,
    reason:
      'Self-reported facial/lip/tongue swelling or throat tightness — potential airway emergency.',
    metadata: {
      conditionLabel: 'Angioedema',
      drugName: med?.drugName,
      drugClass: med ? (ace ? 'ACE_INHIBITOR' : 'ARB') : undefined,
      physicianAnnotations: unverifiedList
        ? [
            'Medication list unverified — cannot rule out ACE inhibitor or ARB exposure. Treat as potential drug-induced angioedema until medication history confirmed.',
          ]
        : undefined,
      // Which symptom(s) fired — drives message-builder wording (lead with
      // throat-tightness phrasing; include "do not take medicine" only when
      // an ACE/ARB is implicated).
      angioedemaFace: s.faceSwelling,
      angioedemaThroat: s.throatTightness,
    },
  }
}
