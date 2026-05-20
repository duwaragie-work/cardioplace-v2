// Cluster 8 §F.2 — message-registry snapshot CI gate.
//
// Snapshots every patient / caregiver / physician string in
// alertMessageRegistry. Any wording change fails CI loudly. This is a
// compliance + clinical-safety guard: clinical + legal signed off on exact
// wording (e.g. the ACE-angioedema "do not take medicine" line). A silent
// edit is a compliance risk — snapshots force the change to be visible in
// a PR diff + reviewed.
//
// Update flow: when the wording legitimately changes (clinical sign-off
// landed), run `jest --updateSnapshot` on this file and ship the snapshot
// diff alongside the registry edit. Reviewers can compare the snapshot
// delta against the sign-off doc.

import {
  alertMessageRegistry,
  RULE_IDS,
} from '@cardioplace/shared'
import type { AlertContext, RuleMessages } from '@cardioplace/shared'

/**
 * Stable context "filled stub" — every optional field populated with a
 * deterministic value so the snapshot doesn't depend on rule-specific
 * defaults. The registry builders that don't reference a field ignore it;
 * the ones that do see the canonical sample below.
 *
 * Two variants are exercised per rule:
 *   STANDARD — preDay3=false, suboptimalMeasurement=false, no annotations
 *   ANNOTATED — preDay3=true, suboptimal=true, physicianAnnotations populated,
 *               singleReadingSession=true, missedMedications populated
 * This catches BOTH the base wording AND the suffix-assembly logic.
 */
function baseCtx(): AlertContext {
  return {
    systolicBP: 145,
    diastolicBP: 85,
    pulse: 72,
    pulsePressure: 60,
    drugName: 'Lisinopril',
    drugNames: ['Lisinopril'],
    drugClass: 'ACE_INHIBITOR',
    conditionLabel: 'Hypertension',
    thresholdValue: 140,
    physicianAnnotations: [],
    preDay3: false,
    suboptimalMeasurement: false,
    missedMedications: undefined,
    adherenceDaysWithMiss: undefined,
    adherenceDaysWithMissOver7d: undefined,
    adherenceBetaBlockerCarveOut: undefined,
    patientName: 'Aisha',
    singleReadingSession: false,
    angioedemaFace: true,
    angioedemaThroat: false,
    bradySustainedSessions: 0,
  }
}

function annotatedCtx(): AlertContext {
  return {
    ...baseCtx(),
    physicianAnnotations: ['Annotation A', 'Annotation B'],
    preDay3: true,
    suboptimalMeasurement: true,
    singleReadingSession: true,
    missedMedications: [
      {
        drugName: 'Lisinopril',
        drugClass: 'ACE_INHIBITOR',
        reason: 'FORGOT',
        missedDoses: 1,
      },
    ],
    adherenceDaysWithMiss: 2,
    adherenceDaysWithMissOver7d: 3,
    adherenceBetaBlockerCarveOut: false,
    angioedemaThroat: true,
    bradySustainedSessions: 4,
  }
}

const ruleValues = Object.values(RULE_IDS) as readonly string[]

describe('Cluster 8 §F.2 — message-registry snapshot gate', () => {
  it('every RULE_ID has a registry entry with all three tiers populated', () => {
    // Coverage guard: every rule MUST have all three message builders. The
    // registry's `Record<RuleId, RuleMessages>` type already enforces this,
    // but the gate makes the failure mode obvious if Record is ever
    // weakened (e.g. to `Partial<Record<...>>`).
    for (const ruleId of ruleValues) {
      const entry = (alertMessageRegistry as Record<string, RuleMessages>)[
        ruleId
      ]
      expect(entry).toBeDefined()
      expect(typeof entry.patientMessage).toBe('function')
      expect(typeof entry.caregiverMessage).toBe('function')
      expect(typeof entry.physicianMessage).toBe('function')
    }
  })

  // One snapshot block per rule. The deterministic context yields a stable
  // string; any edit to the wording or assembly logic fails the snapshot.
  for (const ruleId of ruleValues) {
    describe(ruleId, () => {
      const entry = (alertMessageRegistry as Record<string, RuleMessages>)[
        ruleId
      ]

      it('STANDARD context — patient/caregiver/physician messages match snapshot', () => {
        const ctx = baseCtx()
        expect(entry.patientMessage(ctx)).toMatchSnapshot('patient')
        expect(entry.caregiverMessage(ctx)).toMatchSnapshot('caregiver')
        expect(entry.physicianMessage(ctx)).toMatchSnapshot('physician')
      })

      it('ANNOTATED context (preDay3 + suboptimal + annotations + miss + sustained) — match snapshot', () => {
        const ctx = annotatedCtx()
        expect(entry.patientMessage(ctx)).toMatchSnapshot('patient-annotated')
        expect(entry.caregiverMessage(ctx)).toMatchSnapshot('caregiver-annotated')
        expect(entry.physicianMessage(ctx)).toMatchSnapshot('physician-annotated')
      })
    })
  }

  // Critical clinical-wording invariants — explicit assertions in addition
  // to the snapshot. If a future PR runs `--updateSnapshot` without thought,
  // these still fail and force a clinical sign-off review.

  it('ACE_ANGIOEDEMA patient message INCLUDES "do not take" verbatim (Manisha 5/18/26 sign-off)', () => {
    const ctx = baseCtx()
    const msg = alertMessageRegistry.RULE_ACE_ANGIOEDEMA.patientMessage(ctx)
    expect(msg).toMatch(/do not take any more of your blood pressure medicine/i)
  })

  it('GENERIC_ANGIOEDEMA patient message OMITS the "stop medicine" line', () => {
    const ctx = baseCtx()
    const msg = alertMessageRegistry.RULE_GENERIC_ANGIOEDEMA.patientMessage(ctx)
    expect(msg).not.toMatch(/do not take any more of your blood pressure medicine/i)
  })

  it('BRADY_SURVEILLANCE patient + caregiver messages are EMPTY (physician-only)', () => {
    const ctx = baseCtx()
    expect(alertMessageRegistry.RULE_BRADY_SURVEILLANCE.patientMessage(ctx)).toBe('')
    expect(alertMessageRegistry.RULE_BRADY_SURVEILLANCE.caregiverMessage(ctx)).toBe('')
  })

  it('FIRST_MONTH_ADHERENCE_NUDGE caregiver + physician messages are EMPTY (patient-only)', () => {
    const ctx = baseCtx()
    expect(alertMessageRegistry.RULE_FIRST_MONTH_ADHERENCE_NUDGE.caregiverMessage(ctx)).toBe('')
    expect(alertMessageRegistry.RULE_FIRST_MONTH_ADHERENCE_NUDGE.physicianMessage(ctx)).toBe('')
  })

  it('ACE_ANGIOEDEMA physician message includes the bradykinin framing', () => {
    const ctx = baseCtx()
    const msg = alertMessageRegistry.RULE_ACE_ANGIOEDEMA.physicianMessage(ctx)
    expect(msg).toMatch(/bradykinin-mediated/i)
  })

  it('ACE_ANGIOEDEMA with drugClass=ARB renders the ARB-variant physician message (NOT the bradykinin one)', () => {
    const ctx = { ...baseCtx(), drugName: 'Losartan', drugClass: 'ARB' }
    const msg = alertMessageRegistry.RULE_ACE_ANGIOEDEMA.physicianMessage(ctx)
    expect(msg).toMatch(/ARB-associated angioedema is less common/i)
    expect(msg).not.toMatch(/bradykinin-mediated/i)
  })
})
