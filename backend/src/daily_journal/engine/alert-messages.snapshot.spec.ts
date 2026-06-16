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
  EMERGENCY_CTA,
  CARE_TEAM_NOTIFIED,
  DO_NOT_STOP_MED,
} from '@cardioplace/shared'
import type { AlertContext, RuleId, RuleMessages } from '@cardioplace/shared'

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
    // D4 #1 + #2 (Manisha 2026-06-09) — populate the age + active-med fields
    // so the snapshot gate actually captures agePhrase / medicationListPhrase
    // rendering. With these undefined the helpers return '' and the signed
    // wording would be invisible to the gate (a future splice deletion would
    // pass CI green). age 67 sits in the MESA J-curve cohort; the two meds
    // exercise medicationListPhrase without overloading the snapshot output.
    patientAgeYears: 67,
    activeMedications: [
      { drugName: 'Atenolol', drugClass: 'BETA_BLOCKER' },
      { drugName: 'HCTZ', drugClass: 'THIAZIDE' },
    ],
    // Option D (Manisha 2026-06-12 Q2) — initial emergency-range reading (BP1)
    // for RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL. Deterministic so the
    // two-reading physician message snapshots stably as "185/122 mmHg" (BP1)
    // vs the confirmatory "145/85 mmHg" (BP2 = systolicBP/diastolicBP above).
    initialSystolicBP: 185,
    initialDiastolicBP: 122,
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
        // #83 — thread the rule's own id so physSuffix scopes the single-
        // reading caveat per-rule (profile-axis rules drop it).
        const ctx = { ...baseCtx(), ruleId: ruleId as RuleId }
        expect(entry.patientMessage(ctx)).toMatchSnapshot('patient')
        expect(entry.caregiverMessage(ctx)).toMatchSnapshot('caregiver')
        expect(entry.physicianMessage(ctx)).toMatchSnapshot('physician')
      })

      it('ANNOTATED context (preDay3 + suboptimal + annotations + miss + sustained) — match snapshot', () => {
        const ctx = { ...annotatedCtx(), ruleId: ruleId as RuleId }
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

  // ── Option D — RULE_UNCONFIRMED_EMERGENCY / RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL
  // (Manisha 2026-06-12 Q2). Both provider-only; the physician wording is
  // LOCKED to the sign-off doc. These assertions fail loudly if a future
  // --updateSnapshot softens or reroutes the locked strings.

  it('UNCONFIRMED_EMERGENCY patient + caregiver messages are EMPTY (provider-only)', () => {
    const ctx = baseCtx()
    expect(alertMessageRegistry.RULE_UNCONFIRMED_EMERGENCY.patientMessage(ctx)).toBe('')
    expect(alertMessageRegistry.RULE_UNCONFIRMED_EMERGENCY.caregiverMessage(ctx)).toBe('')
  })

  it('UNCONFIRMED_EMERGENCY physician message matches Manisha 2026-06-12 locked wording', () => {
    const ctx = baseCtx()
    const msg = alertMessageRegistry.RULE_UNCONFIRMED_EMERGENCY.physicianMessage(ctx)
    expect(msg).toBe(
      'Single unconfirmed emergency-range reading: 145/85 mmHg. Patient did not complete confirmatory measurement. Recommend phone outreach to verify current status.',
    )
  })

  it('EMERGENCY_RANGE_CONFIRMED_NORMAL patient + caregiver messages are EMPTY (provider-only)', () => {
    const ctx = baseCtx()
    expect(alertMessageRegistry.RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL.patientMessage(ctx)).toBe('')
    expect(alertMessageRegistry.RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL.caregiverMessage(ctx)).toBe('')
  })

  it('EMERGENCY_RANGE_CONFIRMED_NORMAL physician message spells out BP1 (emergency) + BP2 (confirmatory)', () => {
    const ctx = baseCtx()
    const msg = alertMessageRegistry.RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL.physicianMessage(ctx)
    expect(msg).toBe(
      "Patient's initial reading was 185/122 mmHg (emergency range); confirmatory reading was 145/85 mmHg (below emergency threshold). No emergency alert fired. Review at next encounter.",
    )
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

  // ── Manisha Q5 — Stage 2 axis-specific physician wording ────────────────
  describe('Manisha Q5 — Stage 2 axis-specific wording', () => {
    const phys = (sbp: number, dbp: number) =>
      alertMessageRegistry.RULE_STANDARD_L1_HIGH.physicianMessage({
        ...baseCtx(),
        ruleId: RULE_IDS.STANDARD_L1_HIGH,
        systolicBP: sbp,
        diastolicBP: dbp,
      })

    it('SBP ≥160, DBP <100 → SBP-axis variant', () => {
      const msg = phys(165, 85)
      expect(msg).toContain('severe Stage 2 SBP (SBP ≥160)')
      expect(msg).not.toContain('≥160/100')
    })

    it('DBP ≥100, SBP <160 → DBP-axis variant (no self-contradiction)', () => {
      const msg = phys(119, 109)
      expect(msg).toContain('severe Stage 2 DBP (DBP ≥100)')
      expect(msg).not.toContain('≥160/100')
    })

    it('both axes ≥ → combined variant', () => {
      const msg = phys(170, 105)
      expect(msg).toContain('severe Stage 2 (≥160/100)')
    })
  })

  // ── #83 — single-reading suffix scoped to BP/HR rules only ──────────────
  describe('#83 — single-reading suffix BP/HR-rules only', () => {
    it('does NOT append the suffix to RULE_MEDICATION_MISSED (profile axis)', () => {
      const msg = alertMessageRegistry.RULE_MEDICATION_MISSED.physicianMessage({
        ...annotatedCtx(),
        ruleId: RULE_IDS.MEDICATION_MISSED,
      })
      expect(msg).not.toContain('Single-reading session')
    })

    it('DOES append the suffix to RULE_STANDARD_L1_HIGH (systolic axis) single-reading', () => {
      const msg = alertMessageRegistry.RULE_STANDARD_L1_HIGH.physicianMessage({
        ...annotatedCtx(),
        ruleId: RULE_IDS.STANDARD_L1_HIGH,
      })
      expect(msg).toContain('Single-reading session — confirm with next reading')
    })

    it('still appends NON-single-reading physicianAnnotations on profile rules', () => {
      // The carve-out clinical sentence (a physicianAnnotation) must survive
      // even though the single-reading caveat is suppressed.
      const msg = alertMessageRegistry.RULE_MEDICATION_MISSED.physicianMessage({
        ...annotatedCtx(),
        ruleId: RULE_IDS.MEDICATION_MISSED,
        physicianAnnotations: ['escalate-3-of-7'],
      })
      expect(msg).toContain('escalate-3-of-7')
      expect(msg).not.toContain('Single-reading session')
    })
  })

  // ── Handoff 4 / Document 2 — Manisha-verbatim wording locks ─────────────
  // Lock the highest-stakes alert wording to Manisha's 6/2 copy review so a
  // future --updateSnapshot can't silently soften it. Patient tier carries NO
  // raw BP number (Manisha: raw numbers are anxiety-provoking); caregiver +
  // clinician do.
  describe('Handoff 4 / Doc 2 — verbatim wording locks', () => {
    it('exported fragments match Manisha Doc 2 verbatim', () => {
      expect(EMERGENCY_CTA).toBe(
        ' If you are having chest pain, trouble breathing, or feel like you might faint, call 911 right away.',
      )
      expect(CARE_TEAM_NOTIFIED).toBe('Your care team has been notified.')
      expect(DO_NOT_STOP_MED).toBe(
        'Please do not stop taking any medication on your own without talking to your care team.',
      )
    })

    it('B2 — ABSOLUTE_EMERGENCY patient is directive, 911, do-not-wait, no raw number', () => {
      const msg = alertMessageRegistry.RULE_ABSOLUTE_EMERGENCY.patientMessage(baseCtx())
      expect(msg).toContain('dangerously high')
      expect(msg).toContain('Call 911')
      expect(msg).toContain('Do not wait')
      expect(msg).not.toMatch(/mmHg/) // patient tier never shows the reading
    })

    it('B2 — ABSOLUTE_EMERGENCY caregiver leads with the name + reading + 911', () => {
      const msg = alertMessageRegistry.RULE_ABSOLUTE_EMERGENCY.caregiverMessage(baseCtx())
      expect(msg).toContain('Aisha')
      expect(msg).toContain('145/85 mmHg')
      expect(msg).toContain('911')
    })

    it('B3 — PREGNANCY_ACE_ARB patient does NOT tell the patient to self-discontinue', () => {
      const msg = alertMessageRegistry.RULE_PREGNANCY_ACE_ARB.patientMessage(baseCtx())
      expect(msg).toContain('not recommended during pregnancy')
      expect(msg).toContain('do not stop taking it on your own')
      // The only "stop" instruction must be the negative one above — never an
      // imperative to stop. (The handoff's example test asserted both
      // .not.toMatch(/stop taking/) AND .toContain('do not stop taking it on
      // your own'), which is self-contradictory; this is the corrected lock.)
      expect(msg).not.toMatch(/\bplease stop taking\b/i)
    })

    it('B4 — NDHP_HFREF patient names no class jargon and says do-not-stop', () => {
      const msg = alertMessageRegistry.RULE_NDHP_HFREF.patientMessage(baseCtx())
      expect(msg).toContain('heart condition')
      expect(msg).toContain('do not stop taking it on your own')
    })

    it('B5 — PREGNANCY_L2 patient: urgent, hospital-or-doctor, 911 fallback, no raw number', () => {
      const msg = alertMessageRegistry.RULE_PREGNANCY_L2.patientMessage(baseCtx())
      expect(msg).toContain('very high')
      expect(msg).toContain('go to the hospital')
      expect(msg).toContain('call 911')
      expect(msg).not.toMatch(/mmHg/)
    })

    it('patient tier carries no raw reading across the BP rules (sample)', () => {
      const rules: RuleId[] = [
        RULE_IDS.HFREF_HIGH,
        RULE_IDS.HFPEF_HIGH,
        RULE_IDS.CAD_HIGH,
        RULE_IDS.STANDARD_L1_HIGH,
        RULE_IDS.STANDARD_L1_LOW,
        RULE_IDS.AGE_65_LOW,
      ]
      for (const id of rules) {
        const msg = alertMessageRegistry[id].patientMessage(baseCtx())
        expect(msg).not.toMatch(/mmHg/)
      }
    })

    it('caregiver tier leads with the patient name across the BP rules (sample)', () => {
      const rules: RuleId[] = [
        RULE_IDS.HFREF_LOW,
        RULE_IDS.HFPEF_HIGH,
        RULE_IDS.DCM_LOW,
        RULE_IDS.PERSONALIZED_HIGH,
        RULE_IDS.STANDARD_L1_HIGH,
      ]
      for (const id of rules) {
        const msg = alertMessageRegistry[id].caregiverMessage(baseCtx())
        expect(msg).toContain('Aisha')
      }
    })
  })
})
