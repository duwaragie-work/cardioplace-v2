// Phase/5 pure-function rule coverage — matches the test matrix (§D–§R) in
// the approved plan. No Prisma, no Nest — every rule function takes
// (session, ctx) and returns RuleResult | null.

import {
  getAgeGroup,
  type ContextMedication,
  type ResolvedContext,
} from '@cardioplace/shared'
import {
  findMedWithDrugClass,
  ndhpHfrefRule,
  pregnancyAceArbRule,
} from './contraindications.js'
import {
  symptomOverrideGeneralRule,
  symptomOverridePregnancyRule,
} from './symptom-override.js'
import { absoluteEmergencyRule } from './absolute-emergency.js'
import {
  pregnancyL1HighRule,
  pregnancyL2Rule,
} from './pregnancy-thresholds.js'
import {
  cadDbpRule,
  cadDbpHighRule,
  cadHighRule,
  dcmRule,
  hcmRule,
  hcmVasodilatorRule,
  hfpefRule,
  hfrefRule,
} from './condition-branches.js'
import {
  personalizedHighRule,
  personalizedLowRule,
} from './personalized.js'
import {
  standardL1HighRule,
  standardL1LowRule,
} from './standard.js'
import { afibHrRule, bradyAbsoluteRule, bradySymptomaticRule, buildTachyRule, tachySevereRule } from './hr-branches.js'
import { pulsePressureWideRule } from './pulse-pressure.js'
import { loopDiureticHypotensionRule } from './loop-diuretic.js'
import { medicationMissedRule, medicationMissedRuleWithWindow } from './adherence.js'
import type { AdherenceWindow } from './adherence-window.js'
import type { SessionAverage, SessionSymptoms } from './types.js'

// ─── fixtures ───────────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-04-22T12:00:00Z')

function noSymptoms(): SessionSymptoms {
  return {
    severeHeadache: false,
    visualChanges: false,
    alteredMentalStatus: false,
    chestPainOrDyspnea: false,
    focalNeuroDeficit: false,
    severeEpigastricPain: false,
    newOnsetHeadache: false,
    ruqPain: false,
    edema: false,
    dizziness: false,
    syncope: false,
    palpitations: false,
    legSwelling: false,
    fatigue: false,
    shortnessOfBreath: false,
    dryCough: false,
    nsaidUse: false,
    faceSwelling: false,
    throatTightness: false,
    otherSymptoms: [],
  }
}

function session(over: Partial<SessionAverage> = {}): SessionAverage {
  return {
    entryId: 'entry-1',
    userId: 'user-1',
    measuredAt: FIXED_NOW,
    systolicBP: 125,
    diastolicBP: 75,
    pulse: 72,
    weight: null,
    // Cluster 6 Q2 default: ≥2 readings so non-emergency rules aren't
    // suppressed by the single-reading gate. Tests that want to verify
    // the gate itself pass readingCount=1 explicitly.
    readingCount: 2,
    symptoms: noSymptoms(),
    suboptimalMeasurement: false,
    sessionId: null,
    medicationTaken: null,
    missedMedications: [],
    singleReadingFinalized: false,
    ...over,
  }
}

function med(over: Partial<ContextMedication> = {}): ContextMedication {
  return {
    id: 'm1',
    drugName: 'Lisinopril',
    drugClass: 'ACE_INHIBITOR',
    isCombination: false,
    combinationComponents: [],
    frequency: 'ONCE_DAILY',
    source: 'PATIENT_SELF_REPORT',
    verificationStatus: 'VERIFIED',
    reportedAt: FIXED_NOW,
    ...over,
  }
}

function ctx(over: {
  contextMeds?: ContextMedication[]
  profile?: Partial<ResolvedContext['profile']>
  threshold?: ResolvedContext['threshold']
  pregnancyThresholdsActive?: boolean
  triggerPregnancyContraindicationCheck?: boolean
  readingCount?: number
  personalizedEligible?: boolean
  ageGroup?: ResolvedContext['ageGroup']
  dateOfBirth?: Date | null
  preDay3Mode?: boolean
} = {}): ResolvedContext {
  const profile: ResolvedContext['profile'] = {
    gender: 'FEMALE',
    heightCm: 165,
    isPregnant: false,
    pregnancyDueDate: null,
    historyHDP: false,
    hasHeartFailure: false,
    heartFailureType: 'NOT_APPLICABLE',
    resolvedHFType: 'NOT_APPLICABLE',
    hasAFib: false,
    hasCAD: false,
    hasHCM: false,
    hasDCM: false,
    hasTachycardia: false,
    hasBradycardia: false,
    diagnosedHypertension: false,
    verificationStatus: 'VERIFIED',
    verifiedAt: FIXED_NOW,
    lastEditedAt: FIXED_NOW,
    ...over.profile,
  }
  const readingCount = over.readingCount ?? 10
  const threshold = over.threshold ?? null
  const personalizedEligible =
    over.personalizedEligible ?? (threshold !== null && readingCount >= 7)
  return {
    userId: 'user-1',
    dateOfBirth: over.dateOfBirth ?? new Date('1980-06-15T00:00:00Z'),
    timezone: 'America/New_York',
    ageGroup:
      over.ageGroup ?? getAgeGroup(new Date('1980-06-15T00:00:00Z'), FIXED_NOW),
    profile,
    contextMeds: over.contextMeds ?? [],
    excludedMeds: [],
    threshold,
    assignment: null,
    readingCount,
    preDay3Mode: over.preDay3Mode ?? readingCount < 7,
    personalizedEligible,
    pregnancyThresholdsActive:
      over.pregnancyThresholdsActive ?? profile.isPregnant,
    triggerPregnancyContraindicationCheck:
      over.triggerPregnancyContraindicationCheck ?? profile.isPregnant,
    enrolledAt: null,
    practiceName: null,
    patientName: null,
    resolvedAt: FIXED_NOW,
  }
}

// ─── D.1 Pregnancy + ACE/ARB ────────────────────────────────────────────────
describe('pregnancyAceArbRule (D.1)', () => {
  it('pregnant + lisinopril VERIFIED → Tier 1', () => {
    const r = pregnancyAceArbRule(
      session(),
      ctx({
        profile: { isPregnant: true },
        contextMeds: [med()],
        pregnancyThresholdsActive: true,
        triggerPregnancyContraindicationCheck: true,
      }),
    )
    expect(r).not.toBeNull()
    expect(r?.tier).toBe('TIER_1_CONTRAINDICATION')
    expect(r?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
    expect(r?.metadata.drugName).toBe('Lisinopril')
  })

  it('pregnant + losartan (ARB) → Tier 1', () => {
    const r = pregnancyAceArbRule(
      session(),
      ctx({
        profile: { isPregnant: true },
        contextMeds: [med({ drugName: 'Losartan', drugClass: 'ARB' })],
        triggerPregnancyContraindicationCheck: true,
      }),
    )
    expect(r?.tier).toBe('TIER_1_CONTRAINDICATION')
  })

  it('pregnant + Entresto (combo with ARB component) → Tier 1', () => {
    const r = pregnancyAceArbRule(
      session(),
      ctx({
        profile: { isPregnant: true },
        contextMeds: [
          med({
            drugName: 'Entresto',
            drugClass: 'ARNI',
            isCombination: true,
            combinationComponents: ['ARNI', 'ARB'],
          }),
        ],
        triggerPregnancyContraindicationCheck: true,
      }),
    )
    expect(r?.tier).toBe('TIER_1_CONTRAINDICATION')
  })

  it('pregnant + amlodipine only → no Tier 1', () => {
    const r = pregnancyAceArbRule(
      session(),
      ctx({
        profile: { isPregnant: true },
        contextMeds: [med({ drugName: 'Amlodipine', drugClass: 'DHP_CCB' })],
        triggerPregnancyContraindicationCheck: true,
      }),
    )
    expect(r).toBeNull()
  })

  it('pregnant + UNVERIFIED lisinopril → Tier 1 still fires (safety-net)', () => {
    const r = pregnancyAceArbRule(
      session(),
      ctx({
        profile: { isPregnant: true },
        contextMeds: [med({ verificationStatus: 'UNVERIFIED' })],
        triggerPregnancyContraindicationCheck: true,
      }),
    )
    expect(r?.tier).toBe('TIER_1_CONTRAINDICATION')
  })

  it('not pregnant + lisinopril → no alert', () => {
    const r = pregnancyAceArbRule(session(), ctx({ contextMeds: [med()] }))
    expect(r).toBeNull()
  })

  // Regression: duplicate PatientMedication rows for the same drug were
  // surfacing as "review Lisinopril, Lisinopril, and Lisinopril". The dedup now
  // collapses by normalized drugName in addition to row id.
  it('three duplicate PatientMedication rows for Lisinopril → drugNames lists it ONCE', () => {
    const r = pregnancyAceArbRule(
      session(),
      ctx({
        profile: { isPregnant: true },
        contextMeds: [
          med({ id: 'a', drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR' }),
          med({ id: 'b', drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR' }),
          med({ id: 'c', drugName: 'lisinopril', drugClass: 'ACE_INHIBITOR' }),
        ],
        triggerPregnancyContraindicationCheck: true,
      }),
    )
    expect(r?.tier).toBe('TIER_1_CONTRAINDICATION')
    expect(r?.metadata?.drugNames).toEqual(['Lisinopril'])
  })

  it('genuinely-different ACE/ARB drugs → drugNames lists each (no over-dedup)', () => {
    const r = pregnancyAceArbRule(
      session(),
      ctx({
        profile: { isPregnant: true },
        contextMeds: [
          med({ id: 'a', drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR' }),
          med({ id: 'b', drugName: 'Losartan', drugClass: 'ARB' }),
        ],
        triggerPregnancyContraindicationCheck: true,
      }),
    )
    expect(r?.metadata?.drugNames).toEqual(['Lisinopril', 'Losartan'])
  })
})

// ─── D.2 NDHP-CCB + HFrEF ───────────────────────────────────────────────────
describe('ndhpHfrefRule (D.2)', () => {
  it('HFREF + diltiazem VERIFIED → Tier 1', () => {
    const r = ndhpHfrefRule(
      session(),
      ctx({
        profile: {
          hasHeartFailure: true,
          heartFailureType: 'HFREF',
          resolvedHFType: 'HFREF',
        },
        contextMeds: [
          med({ drugName: 'Diltiazem', drugClass: 'NDHP_CCB' }),
        ],
      }),
    )
    expect(r?.tier).toBe('TIER_1_CONTRAINDICATION')
    expect(r?.ruleId).toBe('RULE_NDHP_HFREF')
  })

  it('HF type UNKNOWN + diltiazem → Tier 1 (safety-net)', () => {
    const r = ndhpHfrefRule(
      session(),
      ctx({
        profile: {
          hasHeartFailure: true,
          heartFailureType: 'UNKNOWN',
          resolvedHFType: 'HFREF',
        },
        contextMeds: [med({ drugClass: 'NDHP_CCB', drugName: 'Diltiazem' })],
      }),
    )
    expect(r?.tier).toBe('TIER_1_CONTRAINDICATION')
  })

  it('HFPEF + diltiazem → no Tier 1', () => {
    const r = ndhpHfrefRule(
      session(),
      ctx({
        profile: {
          hasHeartFailure: true,
          heartFailureType: 'HFPEF',
          resolvedHFType: 'HFPEF',
        },
        contextMeds: [med({ drugClass: 'NDHP_CCB' })],
      }),
    )
    expect(r).toBeNull()
  })

  it('HFREF + amlodipine (DHP) → no Tier 1', () => {
    const r = ndhpHfrefRule(
      session(),
      ctx({
        profile: { resolvedHFType: 'HFREF', hasHeartFailure: true },
        contextMeds: [med({ drugName: 'Amlodipine', drugClass: 'DHP_CCB' })],
      }),
    )
    expect(r).toBeNull()
  })

  it('DCM (resolvedHFType=HFREF via safety-net) + diltiazem → Tier 1', () => {
    const r = ndhpHfrefRule(
      session(),
      ctx({
        profile: {
          hasDCM: true,
          hasHeartFailure: false,
          resolvedHFType: 'HFREF',
        },
        contextMeds: [med({ drugClass: 'NDHP_CCB', drugName: 'Diltiazem' })],
      }),
    )
    expect(r?.tier).toBe('TIER_1_CONTRAINDICATION')
  })

  it('HFREF + UNVERIFIED diltiazem → does NOT fire Tier 1 (spec §V2-A)', () => {
    const r = ndhpHfrefRule(
      session(),
      ctx({
        profile: { resolvedHFType: 'HFREF', hasHeartFailure: true },
        contextMeds: [
          med({ drugClass: 'NDHP_CCB', verificationStatus: 'UNVERIFIED' }),
        ],
      }),
    )
    expect(r).toBeNull()
  })
})

// ─── E. Symptom overrides ───────────────────────────────────────────────────
describe('symptomOverrideGeneralRule (E.1–E.6)', () => {
  const cases: Array<[string, keyof SessionSymptoms]> = [
    ['severeHeadache', 'severeHeadache'],
    ['visualChanges', 'visualChanges'],
    ['alteredMentalStatus', 'alteredMentalStatus'],
    ['chestPainOrDyspnea', 'chestPainOrDyspnea'],
    ['focalNeuroDeficit', 'focalNeuroDeficit'],
    ['severeEpigastricPain', 'severeEpigastricPain'],
  ]
  for (const [label, key] of cases) {
    it(`${label}=true at normal BP → BP Level 2 override`, () => {
      const sym = { ...noSymptoms(), [key]: true }
      const r = symptomOverrideGeneralRule(
        session({ symptoms: sym, systolicBP: 125, diastolicBP: 75 }),
        ctx(),
      )
      expect(r?.tier).toBe('BP_LEVEL_2_SYMPTOM_OVERRIDE')
    })
  }

  it('all false → no alert', () => {
    const r = symptomOverrideGeneralRule(session(), ctx())
    expect(r).toBeNull()
  })

  it('otherSymptoms freeform is ignored by the override', () => {
    const r = symptomOverrideGeneralRule(
      session({ symptoms: { ...noSymptoms(), otherSymptoms: ['dizzy'] } }),
      ctx(),
    )
    expect(r).toBeNull()
  })
})

describe('symptomOverridePregnancyRule (E.7–E.10)', () => {
  it('pregnant + newOnsetHeadache → L2', () => {
    const r = symptomOverridePregnancyRule(
      session({
        symptoms: { ...noSymptoms(), newOnsetHeadache: true },
      }),
      ctx({
        profile: { isPregnant: true },
        pregnancyThresholdsActive: true,
      }),
    )
    expect(r?.tier).toBe('BP_LEVEL_2_SYMPTOM_OVERRIDE')
  })

  it('pregnant + edema at 110/70 → L2', () => {
    const r = symptomOverridePregnancyRule(
      session({
        systolicBP: 110,
        diastolicBP: 70,
        symptoms: { ...noSymptoms(), edema: true },
      }),
      ctx({
        profile: { isPregnant: true },
        pregnancyThresholdsActive: true,
      }),
    )
    expect(r?.tier).toBe('BP_LEVEL_2_SYMPTOM_OVERRIDE')
  })

  it('non-pregnant + newOnsetHeadache alone → no override', () => {
    const r = symptomOverridePregnancyRule(
      session({ symptoms: { ...noSymptoms(), newOnsetHeadache: true } }),
      ctx(),
    )
    expect(r).toBeNull()
  })
})

// ─── F. Absolute emergency ──────────────────────────────────────────────────
describe('absoluteEmergencyRule (F)', () => {
  it('SBP=180 → L2', () => {
    const r = absoluteEmergencyRule(
      session({ systolicBP: 180, diastolicBP: 85 }),
      ctx(),
    )
    expect(r?.tier).toBe('BP_LEVEL_2')
  })

  it('DBP=120 → L2', () => {
    const r = absoluteEmergencyRule(
      session({ systolicBP: 130, diastolicBP: 120 }),
      ctx(),
    )
    expect(r?.tier).toBe('BP_LEVEL_2')
  })

  it('SBP=179, DBP=119 → no alert (boundary)', () => {
    const r = absoluteEmergencyRule(
      session({ systolicBP: 179, diastolicBP: 119 }),
      ctx(),
    )
    expect(r).toBeNull()
  })
})

// ─── G. Pregnancy thresholds ────────────────────────────────────────────────
describe('pregnancyL2Rule + pregnancyL1HighRule (G)', () => {
  const pctx = ctx({
    profile: { isPregnant: true },
    pregnancyThresholdsActive: true,
  })

  it('SBP=160 → L2', () => {
    const r = pregnancyL2Rule(session({ systolicBP: 160, diastolicBP: 90 }), pctx)
    expect(r?.tier).toBe('BP_LEVEL_2')
  })

  it('DBP=110 → L2', () => {
    const r = pregnancyL2Rule(session({ systolicBP: 140, diastolicBP: 110 }), pctx)
    expect(r?.tier).toBe('BP_LEVEL_2')
  })

  it('SBP=140 alone → L1 High (not L2)', () => {
    const l2 = pregnancyL2Rule(session({ systolicBP: 140, diastolicBP: 85 }), pctx)
    expect(l2).toBeNull()
    const l1 = pregnancyL1HighRule(
      session({ systolicBP: 140, diastolicBP: 85 }),
      pctx,
    )
    expect(l1?.tier).toBe('BP_LEVEL_1_HIGH')
  })

  it('SBP=139 → no alert (boundary)', () => {
    const r = pregnancyL1HighRule(
      session({ systolicBP: 139, diastolicBP: 85 }),
      pctx,
    )
    expect(r).toBeNull()
  })

  it('non-pregnant + SBP=145 → no pregnancy alert', () => {
    const r = pregnancyL1HighRule(
      session({ systolicBP: 145, diastolicBP: 85 }),
      ctx(),
    )
    expect(r).toBeNull()
  })

  // Manisha Open-Decisions sign-off 2026-06-06 (Decision 4, conditional
  // exception activated for pilot population on ACE/ARB).
  describe('gestational age threading (Decision 4)', () => {
    it('populates metadata.gestationalAgeWeeks from pregnancyDueDate (L2)', () => {
      // Reading taken at 2026-06-01; EDD 2026-09-21 → 16 weeks until EDD
      // → GA = 40 − 16 = 24 weeks.
      const measured = new Date('2026-06-01T10:00:00Z')
      const due = new Date('2026-09-21T10:00:00Z')
      const ctxWithEdd = ctx({
        profile: { isPregnant: true, pregnancyDueDate: due },
        pregnancyThresholdsActive: true,
      })
      const r = pregnancyL2Rule(
        session({ systolicBP: 165, diastolicBP: 115, measuredAt: measured }),
        ctxWithEdd,
      )
      expect(r?.metadata.gestationalAgeWeeks).toBe(24)
    })

    it('populates metadata.gestationalAgeWeeks (L1 High)', () => {
      const measured = new Date('2026-04-15T10:00:00Z')
      const due = new Date('2026-08-15T10:00:00Z') // ~17 weeks out → GA ~23
      const ctxWithEdd = ctx({
        profile: { isPregnant: true, pregnancyDueDate: due },
        pregnancyThresholdsActive: true,
      })
      const r = pregnancyL1HighRule(
        session({ systolicBP: 145, diastolicBP: 92, measuredAt: measured }),
        ctxWithEdd,
      )
      expect(r?.metadata.gestationalAgeWeeks).toBeGreaterThanOrEqual(22)
      expect(r?.metadata.gestationalAgeWeeks).toBeLessThanOrEqual(24)
    })

    it('gestationalAgeWeeks is null when pregnancyDueDate is missing', () => {
      const ctxNoEdd = ctx({
        profile: { isPregnant: true, pregnancyDueDate: null },
        pregnancyThresholdsActive: true,
      })
      const r = pregnancyL2Rule(
        session({ systolicBP: 165, diastolicBP: 115 }),
        ctxNoEdd,
      )
      expect(r?.metadata.gestationalAgeWeeks).toBeNull()
    })

    it('gestationalAgeWeeks is null when EDD implies an out-of-range value (clamp)', () => {
      // EDD 2 years in the future → GA computes to a negative number → clamp to null.
      const measured = new Date('2026-06-01T10:00:00Z')
      const farFutureDue = new Date('2028-06-01T10:00:00Z')
      const ctxFar = ctx({
        profile: { isPregnant: true, pregnancyDueDate: farFutureDue },
        pregnancyThresholdsActive: true,
      })
      const r = pregnancyL2Rule(
        session({ systolicBP: 165, diastolicBP: 115, measuredAt: measured }),
        ctxFar,
      )
      expect(r?.metadata.gestationalAgeWeeks).toBeNull()
    })
  })
})

// ─── H. HFrEF ───────────────────────────────────────────────────────────────
describe('hfrefRule (H)', () => {
  const hfctx = ctx({
    profile: {
      hasHeartFailure: true,
      heartFailureType: 'HFREF',
      resolvedHFType: 'HFREF',
    },
  })

  it('SBP=90 → no alert (default lower <85)', () => {
    expect(hfrefRule(session({ systolicBP: 90 }), hfctx)).toBeNull()
  })

  it('SBP=84 → L1 Low', () => {
    const r = hfrefRule(session({ systolicBP: 84 }), hfctx)
    expect(r?.tier).toBe('BP_LEVEL_1_LOW')
    expect(r?.ruleId).toBe('RULE_HFREF_LOW')
  })

  it('SBP=160 → L1 High', () => {
    const r = hfrefRule(session({ systolicBP: 160 }), hfctx)
    expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
  })

  it('threshold sbpLowerTarget=100 + SBP=98 → L1 Low (uses override)', () => {
    const withThreshold = ctx({
      profile: { resolvedHFType: 'HFREF', hasHeartFailure: true },
      readingCount: 10,
      threshold: {
        sbpUpperTarget: 130,
        sbpLowerTarget: 100,
        dbpUpperTarget: null,
        dbpLowerTarget: null,
        hrUpperTarget: null,
        hrLowerTarget: null,
        setByProviderId: 'p1',
        setAt: FIXED_NOW,
        notes: null,
      },
    })
    const r = hfrefRule(session({ systolicBP: 98 }), withThreshold)
    expect(r?.tier).toBe('BP_LEVEL_1_LOW')
    expect(r?.mode).toBe('PERSONALIZED')
  })

  it('HF type UNKNOWN → resolvedHFType=HFREF → uses <85 default', () => {
    const r = hfrefRule(
      session({ systolicBP: 84 }),
      ctx({
        profile: {
          hasHeartFailure: true,
          heartFailureType: 'UNKNOWN',
          resolvedHFType: 'HFREF',
        },
      }),
    )
    expect(r?.tier).toBe('BP_LEVEL_1_LOW')
  })
})

// ─── I. HFpEF ───────────────────────────────────────────────────────────────
describe('hfpefRule (I)', () => {
  const hfpctx = ctx({
    profile: {
      hasHeartFailure: true,
      heartFailureType: 'HFPEF',
      resolvedHFType: 'HFPEF',
    },
  })

  it('SBP=105 → L1 Low (<110)', () => {
    const r = hfpefRule(session({ systolicBP: 105 }), hfpctx)
    expect(r?.tier).toBe('BP_LEVEL_1_LOW')
    expect(r?.ruleId).toBe('RULE_HFPEF_LOW')
  })

  it('SBP=115 → no alert', () => {
    expect(hfpefRule(session({ systolicBP: 115 }), hfpctx)).toBeNull()
  })

  it('SBP=160 → L1 High', () => {
    const r = hfpefRule(session({ systolicBP: 160 }), hfpctx)
    expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
  })
})

// ─── J. CAD ─────────────────────────────────────────────────────────────────
// Split into two single-axis rules (cadDbpRule + cadHighRule) so the multi-
// axis orchestrator can fire both for SBP 165 + DBP 65. Each rule is tested
// in isolation; the orchestrator-level co-fire case lives in axis-pipeline.spec.ts.
describe('cadDbpRule (J — DBP axis)', () => {
  const cadctx = ctx({ profile: { hasCAD: true } })

  it('CAD + DBP=69 → DBP-Critical Low', () => {
    const r = cadDbpRule(session({ systolicBP: 140, diastolicBP: 69 }), cadctx)
    expect(r?.tier).toBe('BP_LEVEL_1_LOW')
    expect(r?.ruleId).toBe('RULE_CAD_DBP_CRITICAL')
  })

  it('CAD + DBP=70 → no alert (boundary)', () => {
    expect(
      cadDbpRule(session({ systolicBP: 140, diastolicBP: 70 }), cadctx),
    ).toBeNull()
  })

  it('CAD + DBP=60 + SBP=105 → DBP-Critical (regardless of SBP)', () => {
    const r = cadDbpRule(session({ systolicBP: 105, diastolicBP: 60 }), cadctx)
    expect(r?.ruleId).toBe('RULE_CAD_DBP_CRITICAL')
  })

  it('CAD + SBP=160 DBP=85 → no DBP alert (DBP normal)', () => {
    expect(
      cadDbpRule(session({ systolicBP: 160, diastolicBP: 85 }), cadctx),
    ).toBeNull()
  })
})

describe('cadHighRule (J — SBP-high axis)', () => {
  const cadctx = ctx({ profile: { hasCAD: true } })

  it('CAD + SBP=160 DBP=85 → L1 High', () => {
    const r = cadHighRule(session({ systolicBP: 160, diastolicBP: 85 }), cadctx)
    expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
    expect(r?.ruleId).toBe('RULE_CAD_HIGH')
  })

  it('CAD + SBP=159 → no alert (boundary)', () => {
    expect(
      cadHighRule(session({ systolicBP: 159, diastolicBP: 85 }), cadctx),
    ).toBeNull()
  })

  it('CAD + SBP=140 → no alert', () => {
    expect(
      cadHighRule(session({ systolicBP: 140, diastolicBP: 85 }), cadctx),
    ).toBeNull()
  })
})

// Cluster 8 Q2 (Manisha 5/18/26) — CAD DBP-high "second independent trigger".
describe('cadDbpHighRule (Cluster 8 Q2 — DBP-high axis)', () => {
  const cadctx = ctx({ profile: { hasCAD: true } })

  it('ramp inactive (enrolledAt null, phase 1) + no custom → does NOT fire at DBP 95', () => {
    expect(
      cadDbpHighRule(session({ systolicBP: 145, diastolicBP: 95 }), cadctx),
    ).toBeNull()
  })

  it('phase 3 (ramp all CAD) → CAD 145/95 fires RULE_CAD_DBP_HIGH', () => {
    const prev = process.env.CAD_THRESHOLD_ROLLOUT_PHASE
    process.env.CAD_THRESHOLD_ROLLOUT_PHASE = '3'
    try {
      const r = cadDbpHighRule(session({ systolicBP: 145, diastolicBP: 95 }), cadctx)
      expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
      expect(r?.ruleId).toBe('RULE_CAD_DBP_HIGH')
      expect(r?.actualValue).toBe(95)
    } finally {
      if (prev === undefined) delete process.env.CAD_THRESHOLD_ROLLOUT_PHASE
      else process.env.CAD_THRESHOLD_ROLLOUT_PHASE = prev
    }
  })

  it('phase 3 + DBP=79 → no alert (boundary, default 80)', () => {
    const prev = process.env.CAD_THRESHOLD_ROLLOUT_PHASE
    process.env.CAD_THRESHOLD_ROLLOUT_PHASE = '3'
    try {
      expect(
        cadDbpHighRule(session({ systolicBP: 145, diastolicBP: 79 }), cadctx),
      ).toBeNull()
    } finally {
      if (prev === undefined) delete process.env.CAD_THRESHOLD_ROLLOUT_PHASE
      else process.env.CAD_THRESHOLD_ROLLOUT_PHASE = prev
    }
  })

  it('provider custom dbpUpperTarget fires regardless of ramp phase', () => {
    const customCtx = ctx({
      profile: { hasCAD: true },
      threshold: {
        sbpUpperTarget: null,
        sbpLowerTarget: null,
        dbpUpperTarget: 90,
        dbpLowerTarget: null,
        hrUpperTarget: null,
        hrLowerTarget: null,
        setByProviderId: 'prov-1',
        setAt: FIXED_NOW,
        notes: null,
      },
    })
    const r = cadDbpHighRule(session({ systolicBP: 130, diastolicBP: 92 }), customCtx)
    expect(r?.ruleId).toBe('RULE_CAD_DBP_HIGH')
    expect(r?.metadata.thresholdValue).toBe(90)
  })

  it('non-CAD patient → never fires', () => {
    const prev = process.env.CAD_THRESHOLD_ROLLOUT_PHASE
    process.env.CAD_THRESHOLD_ROLLOUT_PHASE = '3'
    try {
      expect(
        cadDbpHighRule(session({ systolicBP: 145, diastolicBP: 99 }), ctx()),
      ).toBeNull()
    } finally {
      if (prev === undefined) delete process.env.CAD_THRESHOLD_ROLLOUT_PHASE
      else process.env.CAD_THRESHOLD_ROLLOUT_PHASE = prev
    }
  })
})

// ─── K. HCM ─────────────────────────────────────────────────────────────────
// Split into two single-axis rules so the multi-axis orchestrator can fire
// the vasodilator safety flag AND a BP-axis alert on the same reading.
describe('hcmRule (K — BP axis)', () => {
  const hcmctx = ctx({ profile: { hasHCM: true } })

  it('SBP=99 → L1 Low (<100)', () => {
    const r = hcmRule(session({ systolicBP: 99 }), hcmctx)
    expect(r?.tier).toBe('BP_LEVEL_1_LOW')
    expect(r?.ruleId).toBe('RULE_HCM_LOW')
  })

  it('SBP=100 → no alert (boundary)', () => {
    expect(hcmRule(session({ systolicBP: 100 }), hcmctx)).toBeNull()
  })

  it('HCM + vasodilator nitrate + SBP=120 → no BP alert (BP normal)', () => {
    // Vasodilator no longer suppresses the BP arm — they're independent
    // rules now. With SBP=120 (in band), BP-axis stays null. The Tier 3
    // safety flag fires via hcmVasodilatorRule (tested below).
    expect(
      hcmRule(
        session({ systolicBP: 120 }),
        ctx({
          profile: { hasHCM: true },
          contextMeds: [
            med({ drugName: 'Nitroglycerin', drugClass: 'VASODILATOR_NITRATE' }),
          ],
        }),
      ),
    ).toBeNull()
  })
})

describe('hcmVasodilatorRule (K — info axis)', () => {
  it('HCM + vasodilator nitrate → Tier 3 safety flag', () => {
    const r = hcmVasodilatorRule(
      session({ systolicBP: 120 }),
      ctx({
        profile: { hasHCM: true },
        contextMeds: [
          med({ drugName: 'Nitroglycerin', drugClass: 'VASODILATOR_NITRATE' }),
        ],
      }),
    )
    expect(r?.tier).toBe('TIER_3_INFO')
    expect(r?.ruleId).toBe('RULE_HCM_VASODILATOR')
  })

  it('HCM + DHP-CCB → Tier 3', () => {
    const r = hcmVasodilatorRule(
      session({ systolicBP: 120 }),
      ctx({
        profile: { hasHCM: true },
        contextMeds: [med({ drugName: 'Amlodipine', drugClass: 'DHP_CCB' })],
      }),
    )
    expect(r?.tier).toBe('TIER_3_INFO')
  })

  it('HCM + safe meds → no info alert', () => {
    expect(
      hcmVasodilatorRule(
        session({ systolicBP: 120 }),
        ctx({
          profile: { hasHCM: true },
          contextMeds: [med({ drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR' })],
        }),
      ),
    ).toBeNull()
  })
})

// ─── L. DCM ─────────────────────────────────────────────────────────────────
describe('dcmRule (L)', () => {
  const dcmctx = ctx({
    profile: { hasDCM: true, hasHeartFailure: false, resolvedHFType: 'HFREF' },
  })

  it('SBP=84 → L1 Low (<85, same as HFrEF)', () => {
    const r = dcmRule(session({ systolicBP: 84 }), dcmctx)
    expect(r?.tier).toBe('BP_LEVEL_1_LOW')
  })

  it('SBP=160 → L1 High', () => {
    const r = dcmRule(session({ systolicBP: 160 }), dcmctx)
    expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
  })
})

// ─── M. Age 65+ lower override ──────────────────────────────────────────────
describe('standardL1LowRule age-65 override (M)', () => {
  it('Age 67 + SBP=95 → L1 Low (<100)', () => {
    const r = standardL1LowRule(
      session({ systolicBP: 95 }),
      ctx({ ageGroup: '65+' }),
    )
    expect(r?.tier).toBe('BP_LEVEL_1_LOW')
    expect(r?.ruleId).toBe('RULE_AGE_65_LOW')
  })

  it('Age 67 + SBP=100 → no alert (boundary)', () => {
    expect(
      standardL1LowRule(
        session({ systolicBP: 100 }),
        ctx({ ageGroup: '65+' }),
      ),
    ).toBeNull()
  })

  it('Age 45 + SBP=95 → no alert (uses <90)', () => {
    expect(
      standardL1LowRule(
        session({ systolicBP: 95 }),
        ctx({ ageGroup: '40-64' }),
      ),
    ).toBeNull()
  })

  it('Age 45 + SBP=89 → L1 Low (standard)', () => {
    const r = standardL1LowRule(
      session({ systolicBP: 89 }),
      ctx({ ageGroup: '40-64' }),
    )
    expect(r?.ruleId).toBe('RULE_STANDARD_L1_LOW')
  })
})

// ─── N. Standard mode ───────────────────────────────────────────────────────
describe('standardL1HighRule + standardL1LowRule (N)', () => {
  it('SBP=159, DBP=95 → no L1 High alert (just Stage 2 info)', () => {
    expect(
      standardL1HighRule(
        session({ systolicBP: 159, diastolicBP: 95 }),
        ctx(),
      ),
    ).toBeNull()
  })

  it('SBP=160 DBP=95 → L1 High', () => {
    const r = standardL1HighRule(
      session({ systolicBP: 160, diastolicBP: 95 }),
      ctx(),
    )
    expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
  })

  it('DBP=100 → L1 High (DBP axis)', () => {
    const r = standardL1HighRule(
      session({ systolicBP: 140, diastolicBP: 100 }),
      ctx(),
    )
    expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
  })

  it('SBP=89 → L1 Low', () => {
    const r = standardL1LowRule(session({ systolicBP: 89 }), ctx())
    expect(r?.tier).toBe('BP_LEVEL_1_LOW')
  })

  it('SBP=90 → no alert (boundary)', () => {
    expect(standardL1LowRule(session({ systolicBP: 90 }), ctx())).toBeNull()
  })
})

// ─── O. Personalized mode ───────────────────────────────────────────────────
describe('personalized rules (O)', () => {
  const personalCtx = (overUpper = 130, overLower = 90) =>
    ctx({
      readingCount: 10,
      threshold: {
        sbpUpperTarget: overUpper,
        sbpLowerTarget: overLower,
        dbpUpperTarget: null,
        dbpLowerTarget: null,
        hrUpperTarget: null,
        hrLowerTarget: null,
        setByProviderId: 'p1',
        setAt: FIXED_NOW,
        notes: null,
      },
    })

  it('threshold upper=130 + SBP=150 → L1 High (+20)', () => {
    const r = personalizedHighRule(session({ systolicBP: 150 }), personalCtx())
    expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
    expect(r?.mode).toBe('PERSONALIZED')
  })

  it('SBP=149 → no alert (+20 not reached)', () => {
    expect(
      personalizedHighRule(session({ systolicBP: 149 }), personalCtx()),
    ).toBeNull()
  })

  it('threshold lower=110 + SBP=108 → L1 Low', () => {
    const r = personalizedLowRule(
      session({ systolicBP: 108 }),
      personalCtx(130, 110),
    )
    expect(r?.tier).toBe('BP_LEVEL_1_LOW')
  })

  it('threshold exists + <7 readings → not eligible', () => {
    const r = personalizedHighRule(
      session({ systolicBP: 155 }),
      ctx({
        readingCount: 3,
        threshold: {
          sbpUpperTarget: 130,
          sbpLowerTarget: 90,
          dbpUpperTarget: null,
          dbpLowerTarget: null,
          hrUpperTarget: null,
          hrLowerTarget: null,
          setByProviderId: 'p1',
          setAt: FIXED_NOW,
          notes: null,
        },
      }),
    )
    expect(r).toBeNull()
  })
})

// ─── P. HR branches ─────────────────────────────────────────────────────────
describe('afibHrRule (P)', () => {
  const afibCtx = ctx({ profile: { hasAFib: true } })

  it('AFib + pulse=115 → HR L1 High', () => {
    const r = afibHrRule(session({ pulse: 115 }), afibCtx)
    expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
    expect(r?.ruleId).toBe('RULE_AFIB_HR_HIGH')
  })

  it('AFib + pulse=105 → no alert (AFib uses >110, not tachy >100)', () => {
    expect(afibHrRule(session({ pulse: 105 }), afibCtx)).toBeNull()
  })

  it('AFib + pulse=48 → HR L1 Low', () => {
    const r = afibHrRule(session({ pulse: 48 }), afibCtx)
    expect(r?.tier).toBe('BP_LEVEL_1_LOW')
  })
})

describe('tachy rule (P) — Cluster 6 Q5 (Manisha 5/9)', () => {
  const tctx = ctx({ profile: { hasTachycardia: true } })

  it('single elevated HR=105 (prior=false) → no alert', () => {
    const rule = buildTachyRule(false)
    expect(rule(session({ pulse: 105 }), tctx)).toBeNull()
  })

  it('HR=105 + prior=true → consecutive-reading alert', () => {
    const rule = buildTachyRule(true)
    const r = rule(session({ pulse: 105 }), tctx)
    expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
    expect(r?.ruleId).toBe('RULE_TACHY_HR')
    expect(r?.reason).toMatch(/8h/)
  })

  // The HR>130 single-reading Q5 exception moved out of buildTachyRule into
  // tachySevereRule (NIVA_HR), so it can run pre-gate and fire on one reading.
  it('HR=132 single-reading → Q5 severe-tachy exception fires immediately (tachySevereRule)', () => {
    const r = tachySevereRule(session({ pulse: 132 }), tctx)
    expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
    expect(r?.ruleId).toBe('RULE_TACHY_HR')
    expect(r?.reason).toMatch(/severe|130/i)
  })

  it('HR=130 (boundary, not strictly >130) → no severe-tachy alert', () => {
    expect(tachySevereRule(session({ pulse: 130 }), tctx)).toBeNull()
  })

  it('HR=131 single-reading → severe exception fires (tachySevereRule)', () => {
    const r = tachySevereRule(session({ pulse: 131 }), tctx)
    expect(r?.ruleId).toBe('RULE_TACHY_HR')
  })

  it('buildTachyRule no longer fires on HR>130 alone (prior=false) — that path is tachySevereRule now', () => {
    expect(buildTachyRule(false)(session({ pulse: 132 }), tctx)).toBeNull()
  })

  it('non-tachycardia patient HR=132 → no alert (gate stays on flag)', () => {
    const noFlagCtx = ctx({ profile: { hasTachycardia: false } })
    expect(tachySevereRule(session({ pulse: 132 }), noFlagCtx)).toBeNull()
  })
})

describe('bradySymptomaticRule (P)', () => {
  const bctx = ctx({ profile: { hasBradycardia: true } })

  it('HR=48 + chestPain → symptomatic L1', () => {
    const r = bradySymptomaticRule(
      session({
        pulse: 48,
        symptoms: { ...noSymptoms(), chestPainOrDyspnea: true },
      }),
      bctx,
    )
    expect(r?.tier).toBe('BP_LEVEL_1_LOW')
    expect(r?.ruleId).toBe('RULE_BRADY_HR_SYMPTOMATIC')
  })

  // Cluster 6 (Manisha 5/10/26) — HR<40 is now owned by bradyAbsoluteRule
  // (Tier 1) — bradySymptomaticRule covers only [40, 50). The absolute rule
  // fires regardless of symptoms; this spec covers both branches.
  it('HR=38 asymptomatic → bradyAbsoluteRule (Tier 1), bradySymptomaticRule no-fires', () => {
    expect(bradySymptomaticRule(session({ pulse: 38 }), bctx)).toBeNull()
    const abs = bradyAbsoluteRule(session({ pulse: 38 }), bctx)
    expect(abs?.ruleId).toBe('RULE_BRADY_ABSOLUTE')
    expect(abs?.tier).toBe('TIER_1_CONTRAINDICATION')
  })

  it('HR=48 + dizziness → bradySymptomaticRule fires (predicate widened in Cluster 6)', () => {
    const r = bradySymptomaticRule(
      session({
        pulse: 48,
        symptoms: { ...noSymptoms(), dizziness: true },
      }),
      bctx,
    )
    expect(r?.ruleId).toBe('RULE_BRADY_HR_SYMPTOMATIC')
  })

  it('HR=55 → no alert', () => {
    expect(bradySymptomaticRule(session({ pulse: 55 }), bctx)).toBeNull()
  })

  it('beta-blocker + HR=55 → suppressed', () => {
    const r = bradySymptomaticRule(
      session({
        pulse: 55,
        symptoms: { ...noSymptoms(), chestPainOrDyspnea: true },
      }),
      ctx({
        profile: { hasBradycardia: true },
        contextMeds: [med({ drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER' })],
      }),
    )
    expect(r).toBeNull()
  })

  it('beta-blocker + HR=48 + symptoms → alert (below 50 fires)', () => {
    const r = bradySymptomaticRule(
      session({
        pulse: 48,
        symptoms: { ...noSymptoms(), chestPainOrDyspnea: true },
      }),
      ctx({
        profile: { hasBradycardia: true },
        contextMeds: [med({ drugClass: 'BETA_BLOCKER' })],
      }),
    )
    expect(r?.ruleId).toBe('RULE_BRADY_HR_SYMPTOMATIC')
  })
})

// ─── Q. Pulse pressure ──────────────────────────────────────────────────────
describe('pulsePressureWideRule (Q)', () => {
  it('170/85 → PP 85 → Tier 3', () => {
    const r = pulsePressureWideRule(
      session({ systolicBP: 170, diastolicBP: 85 }),
      ctx(),
    )
    expect(r?.tier).toBe('TIER_3_INFO')
    expect(r?.pulsePressure).toBe(85)
  })

  it('140/85 → PP 55 → no alert', () => {
    expect(
      pulsePressureWideRule(
        session({ systolicBP: 140, diastolicBP: 85 }),
        ctx(),
      ),
    ).toBeNull()
  })

  it('140/80 → PP 60 boundary → no alert (strict >60)', () => {
    expect(
      pulsePressureWideRule(
        session({ systolicBP: 140, diastolicBP: 80 }),
        ctx(),
      ),
    ).toBeNull()
  })
})

// ─── R. Loop diuretic ───────────────────────────────────────────────────────
describe('loopDiureticHypotensionRule (R) — Cluster 6 Q1 (Manisha 5/9)', () => {
  const lctx = ctx({
    contextMeds: [med({ drugName: 'Furosemide', drugClass: 'LOOP_DIURETIC' })],
  })

  it('loop + SBP=89 (below strict 90 cutoff) → Tier 3 fires', () => {
    const r = loopDiureticHypotensionRule(session({ systolicBP: 89 }), lctx)
    expect(r?.tier).toBe('TIER_3_INFO')
  })

  it('loop + SBP=90 (boundary) → no alert', () => {
    expect(
      loopDiureticHypotensionRule(session({ systolicBP: 90 }), lctx),
    ).toBeNull()
  })

  it('loop + SBP=91 (was 90-92 band) → no alert (band dropped per Manisha Q1)', () => {
    expect(
      loopDiureticHypotensionRule(session({ systolicBP: 91 }), lctx),
    ).toBeNull()
  })

  it('loop + SBP=92 → no alert (band dropped)', () => {
    expect(
      loopDiureticHypotensionRule(session({ systolicBP: 92 }), lctx),
    ).toBeNull()
  })

  it('loop + SBP=100 → no alert', () => {
    expect(
      loopDiureticHypotensionRule(session({ systolicBP: 100 }), lctx),
    ).toBeNull()
  })

  it('HF precedence — HFrEF patient at SBP=80 → no loop alert (HF rule subsumes)', () => {
    const hfCtx = ctx({
      contextMeds: [med({ drugName: 'Furosemide', drugClass: 'LOOP_DIURETIC' })],
      profile: { hasHeartFailure: true, resolvedHFType: 'HFREF' },
    })
    expect(
      loopDiureticHypotensionRule(session({ systolicBP: 80 }), hfCtx),
    ).toBeNull()
  })

  it('HF precedence — HFpEF patient at SBP=85 → no loop alert', () => {
    const hfCtx = ctx({
      contextMeds: [med({ drugName: 'Furosemide', drugClass: 'LOOP_DIURETIC' })],
      profile: { hasHeartFailure: true, resolvedHFType: 'HFPEF' },
    })
    expect(
      loopDiureticHypotensionRule(session({ systolicBP: 85 }), hfCtx),
    ).toBeNull()
  })

  it('HF precedence — DCM patient at SBP=85 → no loop alert', () => {
    const hfCtx = ctx({
      contextMeds: [med({ drugName: 'Furosemide', drugClass: 'LOOP_DIURETIC' })],
      profile: { hasDCM: true },
    })
    expect(
      loopDiureticHypotensionRule(session({ systolicBP: 85 }), hfCtx),
    ).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Part C — Audit coverage gap closures
// ───────────────────────────────────────────────────────────────────────────

// Zestoretic = Lisinopril (ACE) + HCTZ (THIAZIDE). `registersAs` puts
// ACE_INHIBITOR in the combo's components → pregnancy+ACE contraindication
// must fire via the combo-component path.
describe('pregnancyAceArbRule + Zestoretic combo (D.1 gap)', () => {
  it('pregnant + Zestoretic → Tier 1 fires via ACE_INHIBITOR combo component', () => {
    const r = pregnancyAceArbRule(
      session(),
      ctx({
        profile: { isPregnant: true },
        triggerPregnancyContraindicationCheck: true,
        contextMeds: [
          med({
            drugName: 'Zestoretic',
            // Combos are typically stored with a single primary drugClass +
            // combo components; matches how seed.ts builds rows. Primary
            // class here doesn't matter — combo components carry ACE.
            drugClass: 'OTHER_UNVERIFIED',
            isCombination: true,
            combinationComponents: ['ACE_INHIBITOR', 'THIAZIDE'],
            verificationStatus: 'VERIFIED',
          }),
        ],
      }),
    )
    expect(r?.tier).toBe('TIER_1_CONTRAINDICATION')
    expect(r?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
    expect(r?.metadata.drugName).toBe('Zestoretic')
  })
})

// Bug 5 fix — the shared helper.
describe('findMedWithDrugClass helper (Bug 5)', () => {
  it('matches primary drugClass', () => {
    expect(
      findMedWithDrugClass(
        [med({ drugClass: 'NDHP_CCB', drugName: 'Diltiazem' })],
        'NDHP_CCB',
      )?.drugName,
    ).toBe('Diltiazem')
  })

  it('matches via combinationComponents for a combo', () => {
    expect(
      findMedWithDrugClass(
        [
          med({
            drugName: 'Entresto',
            drugClass: 'ARNI',
            isCombination: true,
            combinationComponents: ['ARNI', 'ARB'],
          }),
        ],
        'ARB',
      )?.drugName,
    ).toBe('Entresto')
  })

  it('returns null when target missing from both primary and components', () => {
    expect(
      findMedWithDrugClass(
        [med({ drugClass: 'STATIN', drugName: 'Atorvastatin' })],
        'NDHP_CCB',
      ),
    ).toBeNull()
  })
})

// Pregnancy L1 on DBP axis alone.
describe('pregnancyL1HighRule DBP-only path (G gap)', () => {
  it('pregnant + SBP=130 DBP=90 → L1 High via DBP axis', () => {
    const r = pregnancyL1HighRule(
      session({ systolicBP: 130, diastolicBP: 90 }),
      ctx({
        profile: { isPregnant: true },
        pregnancyThresholdsActive: true,
      }),
    )
    expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
    expect(r?.ruleId).toBe('RULE_PREGNANCY_L1_HIGH')
  })
})

// Pregnancy symptom override — ruqPain alone.
describe('symptomOverridePregnancyRule ruqPain (E gap)', () => {
  it('pregnant + ruqPain only → BP Level 2 override', () => {
    const r = symptomOverridePregnancyRule(
      session({
        symptoms: { ...noSymptoms(), ruqPain: true },
      }),
      ctx({
        profile: { isPregnant: true },
        pregnancyThresholdsActive: true,
      }),
    )
    expect(r?.tier).toBe('BP_LEVEL_2_SYMPTOM_OVERRIDE')
    expect(r?.metadata.conditionLabel).toContain('RUQ')
  })
})

// HCM plain upper bound — no flagged meds.
describe('hcmRule plain upper bound (K gap)', () => {
  it('HCM + SBP=160 no flagged meds → L1 High (not vasodilator flag)', () => {
    const r = hcmRule(
      session({ systolicBP: 160 }),
      ctx({ profile: { hasHCM: true } }),
    )
    expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
    expect(r?.ruleId).toBe('RULE_HCM_HIGH')
  })
})

// Beta-blocker + AFib — AFib rule wins over beta-blocker suppression.
// Suppression window is 50–60; AFib threshold is >110.
describe('afibHrRule + beta-blocker precedence (P gap)', () => {
  it('BB + AFib + HR=115 → AFib HR High still fires (suppression is 50–60 only)', () => {
    const r = afibHrRule(
      session({ pulse: 115 }),
      ctx({
        profile: { hasAFib: true },
        contextMeds: [
          med({ drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER' }),
        ],
      }),
    )
    expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
    expect(r?.ruleId).toBe('RULE_AFIB_HR_HIGH')
  })

  it('BB + AFib + HR=55 → AFib rule does not fire (HR not <50 or >110)', () => {
    const r = afibHrRule(
      session({ pulse: 55 }),
      ctx({
        profile: { hasAFib: true },
        contextMeds: [med({ drugClass: 'BETA_BLOCKER' })],
      }),
    )
    expect(r).toBeNull()
  })
})

// Unverified known-class beta-blocker — spec §V2-A keeps suppression active.
describe('medicationMissedRule — Phase/26 scheduledLater regression', () => {
  // Phase/26 silent-literacy added a "Not Due Yet" option in the CheckIn
  // medication step. The wizard submits `medicationTaken: undefined` and
  // the new `medicationScheduledLater: true` flag for scheduledLater. The
  // adherence rule must NOT fire on that — only on an explicit "missed".
  // The rule looks at session.medicationTaken; the new flag rides on the
  // JournalEntry row but is intentionally not part of the SessionAverage
  // (no rule logic depends on it), so we just assert the existing strict
  // equality check stays correct.

  it('medicationTaken=undefined (scheduledLater path) → null', () => {
    const r = medicationMissedRule(
      session({ medicationTaken: null, missedMedications: [] }),
      // ctx is only used for AFib gating in some rules; this rule ignores it.
      { profile: {}, contextMeds: [], thresholds: {}, preDay3Mode: false } as unknown as ResolvedContext,
    )
    expect(r).toBeNull()
  })

  it('medicationTaken=true → null (took everything)', () => {
    const r = medicationMissedRule(
      session({ medicationTaken: true, missedMedications: [] }),
      { profile: {}, contextMeds: [], thresholds: {}, preDay3Mode: false } as unknown as ResolvedContext,
    )
    expect(r).toBeNull()
  })

  // Cluster 6 (Manisha 5/10/26) — adherence is now pattern-based (2 of 3
  // days) with a single-miss carve-out for β-blocker in HFrEF/HCM/AFib.
  // The legacy single-session `medicationMissedRule` always returns null
  // because pattern detection requires the rolling window. These tests
  // verify both the rolling rule + carve-out via the windowed variant.

  it('legacy medicationMissedRule(session=missed-once) → null (no window)', () => {
    const r = medicationMissedRule(
      session({ medicationTaken: false, missedMedications: [] }),
      { profile: {}, contextMeds: [], thresholds: {}, preDay3Mode: false } as unknown as ResolvedContext,
    )
    expect(r).toBeNull()
  })

  it('windowed rule: daysWithMiss=2 → RULE_MEDICATION_MISSED fires', () => {
    const window: AdherenceWindow = {
      daysWithMiss: 2,
      daysWithMissOver7d: 2,
      missesByDrugClass: new Map([['ACE_INHIBITOR', 2]]),
      missedMedications: [
        {
          medicationId: 'm1',
          drugName: 'Lisinopril',
          drugClass: 'ACE_INHIBITOR',
          reason: 'FORGOT',
          missedDoses: 2,
        },
      ],
    }
    const r = medicationMissedRuleWithWindow(window)(
      session({ medicationTaken: false, missedMedications: [] }),
      ctx({ profile: { hasHeartFailure: false, hasHCM: false, hasAFib: false } }),
    )
    expect(r?.ruleId).toBe('RULE_MEDICATION_MISSED')
    expect(r?.tier).toBe('TIER_2_DISCREPANCY')
  })

  it('windowed rule: single miss for non-beta-blocker → null', () => {
    const window: AdherenceWindow = {
      daysWithMiss: 1,
      daysWithMissOver7d: 1,
      missesByDrugClass: new Map([['ACE_INHIBITOR', 1]]),
      missedMedications: [
        {
          medicationId: 'm1',
          drugName: 'Lisinopril',
          drugClass: 'ACE_INHIBITOR',
          reason: 'FORGOT',
          missedDoses: 1,
        },
      ],
    }
    const r = medicationMissedRuleWithWindow(window)(
      session({ medicationTaken: false, missedMedications: [] }),
      ctx({ profile: { hasHeartFailure: false } }),
    )
    expect(r).toBeNull()
  })

  it('windowed rule: single beta-blocker miss in HFrEF patient → fires (carve-out)', () => {
    const window: AdherenceWindow = {
      daysWithMiss: 1,
      daysWithMissOver7d: 1,
      missesByDrugClass: new Map([['BETA_BLOCKER', 1]]),
      missedMedications: [
        {
          medicationId: 'm1',
          drugName: 'Metoprolol',
          drugClass: 'BETA_BLOCKER',
          reason: 'FORGOT',
          missedDoses: 1,
        },
      ],
    }
    const r = medicationMissedRuleWithWindow(window)(
      session({ medicationTaken: false, missedMedications: [] }),
      ctx({ profile: { hasHeartFailure: true } }),
    )
    expect(r?.ruleId).toBe('RULE_MEDICATION_MISSED')
    expect(r?.metadata.adherenceBetaBlockerCarveOut).toBe(true)
    // #93 (2026-06-03) — the physician annotation is clinical prose, not the
    // old "beta-blocker-carve-out" debug tag.
    expect(r?.metadata.physicianAnnotations).toContain(
      'Tier 2 dispatched on single missed dose per HFrEF / HCM / AFib β-blocker safety policy.',
    )
    expect(r?.metadata.physicianAnnotations).not.toContain('beta-blocker-carve-out')
  })

  it('windowed rule: single beta-blocker miss in patient WITHOUT HF/HCM/AFib → null', () => {
    const window: AdherenceWindow = {
      daysWithMiss: 1,
      daysWithMissOver7d: 1,
      missesByDrugClass: new Map([['BETA_BLOCKER', 1]]),
      missedMedications: [
        {
          medicationId: 'm1',
          drugName: 'Metoprolol',
          drugClass: 'BETA_BLOCKER',
          reason: 'FORGOT',
          missedDoses: 1,
        },
      ],
    }
    const r = medicationMissedRuleWithWindow(window)(
      session({ medicationTaken: false, missedMedications: [] }),
      ctx({ profile: { hasHeartFailure: false, hasHCM: false, hasAFib: false } }),
    )
    expect(r).toBeNull()
  })

  it('windowed rule: ≥3-of-7 days adds physician escalation annotation', () => {
    const window: AdherenceWindow = {
      daysWithMiss: 2,
      daysWithMissOver7d: 4,
      missesByDrugClass: new Map([['ACE_INHIBITOR', 2]]),
      missedMedications: [
        {
          medicationId: 'm1',
          drugName: 'Lisinopril',
          drugClass: 'ACE_INHIBITOR',
          reason: 'FORGOT',
          missedDoses: 2,
        },
      ],
    }
    const r = medicationMissedRuleWithWindow(window)(
      session({ medicationTaken: false, missedMedications: [] }),
      ctx({ profile: { hasHeartFailure: false } }),
    )
    expect(r?.metadata.physicianAnnotations).toContain(
      'Tier 2 dispatched on 3-of-7 missed-dose pattern per adherence-trending escalation policy.',
    )
    expect(r?.metadata.physicianAnnotations).not.toContain('escalate-3-of-7')
  })
})

describe('bradySymptomaticRule unverified beta-blocker suppression (P gap)', () => {
  it('UNVERIFIED beta-blocker + HR=55 + symptoms → still suppressed', () => {
    const r = bradySymptomaticRule(
      session({
        pulse: 55,
        symptoms: { ...noSymptoms(), chestPainOrDyspnea: true },
      }),
      ctx({
        profile: { hasBradycardia: true },
        contextMeds: [
          med({
            drugName: 'Metoprolol',
            drugClass: 'BETA_BLOCKER',
            verificationStatus: 'UNVERIFIED',
          }),
        ],
      }),
    )
    expect(r).toBeNull()
  })
})

// ─── Cluster 7 (Manisha 5/11/26) — Appendix A side-effect rules ─────────────

import {
  aceCoughRule,
  afibPalpitationsRule,
  betaBlockerFatigueRule,
  betaBlockerSobHfRule,
  betaBlockerSobNonHfRule,
  hfCaregiverEdemaRule,
  nsaidAntihypertensiveRule,
  palpitationsGeneralRule,
  tachyPalpitationsRule,
} from './symptom-rules.js'

describe('Cluster 7 — betaBlockerFatigueRule (A.1)', () => {
  it('fires on β-blocker + fatigue symptom', () => {
    const r = betaBlockerFatigueRule(
      session({ symptoms: { ...noSymptoms(), fatigue: true } }),
      ctx({ contextMeds: [med({ drugClass: 'BETA_BLOCKER', drugName: 'Metoprolol' })] }),
    )
    expect(r?.ruleId).toBe('RULE_BETA_BLOCKER_FATIGUE')
    expect(r?.tier).toBe('TIER_3_INFO')
  })

  it('does not fire without fatigue symptom', () => {
    const r = betaBlockerFatigueRule(
      session(),
      ctx({ contextMeds: [med({ drugClass: 'BETA_BLOCKER' })] }),
    )
    expect(r).toBeNull()
  })

  it('does not fire without a β-blocker in the med list', () => {
    const r = betaBlockerFatigueRule(
      session({ symptoms: { ...noSymptoms(), fatigue: true } }),
      ctx({ contextMeds: [med({ drugClass: 'ACE_INHIBITOR' })] }),
    )
    expect(r).toBeNull()
  })
})

describe('Cluster 7 — betaBlockerSobHfRule (A.2 HF variant)', () => {
  it('fires Tier 2 on HF + β-blocker + SOB', () => {
    const r = betaBlockerSobHfRule(
      session({ symptoms: { ...noSymptoms(), shortnessOfBreath: true } }),
      ctx({
        profile: { hasHeartFailure: true, resolvedHFType: 'HFREF' },
        contextMeds: [med({ drugClass: 'BETA_BLOCKER' })],
      }),
    )
    expect(r?.ruleId).toBe('RULE_BETA_BLOCKER_SOB_HF')
    expect(r?.tier).toBe('TIER_2_DISCREPANCY')
  })

  it('does not fire for non-HF patient', () => {
    const r = betaBlockerSobHfRule(
      session({ symptoms: { ...noSymptoms(), shortnessOfBreath: true } }),
      ctx({ contextMeds: [med({ drugClass: 'BETA_BLOCKER' })] }),
    )
    expect(r).toBeNull()
  })
})

describe('Cluster 7 — betaBlockerSobNonHfRule (A.2 non-HF variant)', () => {
  it('fires Tier 3 on non-HF + β-blocker + SOB', () => {
    const r = betaBlockerSobNonHfRule(
      session({ symptoms: { ...noSymptoms(), shortnessOfBreath: true } }),
      ctx({ contextMeds: [med({ drugClass: 'BETA_BLOCKER' })] }),
    )
    expect(r?.ruleId).toBe('RULE_BETA_BLOCKER_SOB_NON_HF')
    expect(r?.tier).toBe('TIER_3_INFO')
  })

  it('does not fire for HF patient (HF variant takes over)', () => {
    const r = betaBlockerSobNonHfRule(
      session({ symptoms: { ...noSymptoms(), shortnessOfBreath: true } }),
      ctx({
        profile: { hasHeartFailure: true, resolvedHFType: 'HFREF' },
        contextMeds: [med({ drugClass: 'BETA_BLOCKER' })],
      }),
    )
    expect(r).toBeNull()
  })
})

describe('Cluster 7 — nsaidAntihypertensiveRule (A.3)', () => {
  it('fires when patient flags nsaidUse + has antihypertensive', () => {
    const r = nsaidAntihypertensiveRule(
      session({ symptoms: { ...noSymptoms(), nsaidUse: true } }),
      ctx({ contextMeds: [med({ drugClass: 'ACE_INHIBITOR' })] }),
    )
    expect(r?.ruleId).toBe('RULE_NSAID_ANTIHTN_INTERACTION')
    expect(r?.tier).toBe('TIER_3_INFO')
  })

  it('fires when NSAID is in med list + antihypertensive present', () => {
    const r = nsaidAntihypertensiveRule(
      session(),
      ctx({
        contextMeds: [
          med({ drugClass: 'NSAID', drugName: 'Ibuprofen' }),
          med({ drugClass: 'BETA_BLOCKER' }),
        ],
      }),
    )
    expect(r?.ruleId).toBe('RULE_NSAID_ANTIHTN_INTERACTION')
  })

  it('does not fire without an antihypertensive', () => {
    const r = nsaidAntihypertensiveRule(
      session({ symptoms: { ...noSymptoms(), nsaidUse: true } }),
      ctx({ contextMeds: [med({ drugClass: 'STATIN' })] }),
    )
    expect(r).toBeNull()
  })

  it('does not fire without NSAID surface', () => {
    const r = nsaidAntihypertensiveRule(
      session(),
      ctx({ contextMeds: [med({ drugClass: 'ACE_INHIBITOR' })] }),
    )
    expect(r).toBeNull()
  })
})

describe('Cluster 7 — aceCoughRule (A.4)', () => {
  it('fires on ACE inhibitor + dryCough', () => {
    const r = aceCoughRule(
      session({ symptoms: { ...noSymptoms(), dryCough: true } }),
      ctx({ contextMeds: [med({ drugClass: 'ACE_INHIBITOR' })] }),
    )
    expect(r?.ruleId).toBe('RULE_ACE_COUGH')
    expect(r?.tier).toBe('TIER_3_INFO')
  })

  it('does not fire on ARB (different class)', () => {
    const r = aceCoughRule(
      session({ symptoms: { ...noSymptoms(), dryCough: true } }),
      ctx({ contextMeds: [med({ drugClass: 'ARB' })] }),
    )
    expect(r).toBeNull()
  })

  it('does not fire without dryCough', () => {
    const r = aceCoughRule(
      session(),
      ctx({ contextMeds: [med({ drugClass: 'ACE_INHIBITOR' })] }),
    )
    expect(r).toBeNull()
  })
})

describe('Cluster 7 — hfCaregiverEdemaRule (A.6)', () => {
  it('fires on HF + legSwelling', () => {
    const r = hfCaregiverEdemaRule(
      session({ symptoms: { ...noSymptoms(), legSwelling: true } }),
      ctx({ profile: { hasHeartFailure: true, resolvedHFType: 'HFREF' } }),
    )
    expect(r?.ruleId).toBe('RULE_HF_CAREGIVER_EDEMA')
    expect(r?.tier).toBe('TIER_3_INFO')
  })

  it('does not fire for non-HF patient (DHP-CCB rule handles those)', () => {
    const r = hfCaregiverEdemaRule(
      session({ symptoms: { ...noSymptoms(), legSwelling: true } }),
      ctx(),
    )
    expect(r).toBeNull()
  })

  it('does not fire without legSwelling', () => {
    const r = hfCaregiverEdemaRule(
      session(),
      ctx({ profile: { hasHeartFailure: true, resolvedHFType: 'HFREF' } }),
    )
    expect(r).toBeNull()
  })
})

// ─── Cluster 5/6 — palpitation rules (B.1 coverage; removed from §F.1 allowlist) ──
//
// Three mutually-exclusive branches off session.symptoms.palpitations:
//   • afibPalpitationsRule       — hasAFib                → BP_LEVEL_1_LOW
//   • tachyPalpitationsRule      — !hasAFib + pulse >100  → BP_LEVEL_1_HIGH
//   • palpitationsGeneralRule    — !hasAFib + pulse ≤100  → TIER_3_INFO

describe('Cluster 6 — afibPalpitationsRule', () => {
  it('fires BP_LEVEL_1_LOW when AFib patient reports palpitations', () => {
    const r = afibPalpitationsRule(
      session({ symptoms: { ...noSymptoms(), palpitations: true } }),
      ctx({ profile: { hasAFib: true } }),
    )
    expect(r?.ruleId).toBe('RULE_AFIB_PALPITATIONS')
    expect(r?.tier).toBe('BP_LEVEL_1_LOW')
  })

  it('does not fire without the palpitations symptom', () => {
    const r = afibPalpitationsRule(session(), ctx({ profile: { hasAFib: true } }))
    expect(r).toBeNull()
  })

  it('does not fire for a non-AFib patient (defers to tachy/general)', () => {
    const r = afibPalpitationsRule(
      session({ symptoms: { ...noSymptoms(), palpitations: true } }),
      ctx({ profile: { hasAFib: false } }),
    )
    expect(r).toBeNull()
  })
})

describe('Cluster 6 — tachyPalpitationsRule', () => {
  it('fires BP_LEVEL_1_HIGH for palpitations + HR >100 in a non-AFib patient', () => {
    const r = tachyPalpitationsRule(
      session({ pulse: 118, symptoms: { ...noSymptoms(), palpitations: true } }),
      ctx({ profile: { hasAFib: false } }),
    )
    expect(r?.ruleId).toBe('RULE_TACHY_WITH_PALPITATIONS')
    expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
  })

  it('does not fire at exactly HR 100 (strict >100)', () => {
    const r = tachyPalpitationsRule(
      session({ pulse: 100, symptoms: { ...noSymptoms(), palpitations: true } }),
      ctx({ profile: { hasAFib: false } }),
    )
    expect(r).toBeNull()
  })

  it('does not fire for an AFib patient (afib branch owns it)', () => {
    const r = tachyPalpitationsRule(
      session({ pulse: 118, symptoms: { ...noSymptoms(), palpitations: true } }),
      ctx({ profile: { hasAFib: true } }),
    )
    expect(r).toBeNull()
  })
})

describe('Cluster 6 — palpitationsGeneralRule', () => {
  it('fires TIER_3_INFO for palpitations + normal rate in a non-AFib patient', () => {
    const r = palpitationsGeneralRule(
      session({ pulse: 78, symptoms: { ...noSymptoms(), palpitations: true } }),
      ctx({ profile: { hasAFib: false } }),
    )
    expect(r?.ruleId).toBe('RULE_PALPITATIONS_GENERAL')
    expect(r?.tier).toBe('TIER_3_INFO')
  })

  it('does not fire when HR >100 (tachy branch owns it)', () => {
    const r = palpitationsGeneralRule(
      session({ pulse: 118, symptoms: { ...noSymptoms(), palpitations: true } }),
      ctx({ profile: { hasAFib: false } }),
    )
    expect(r).toBeNull()
  })

  it('does not fire for an AFib patient', () => {
    const r = palpitationsGeneralRule(
      session({ pulse: 78, symptoms: { ...noSymptoms(), palpitations: true } }),
      ctx({ profile: { hasAFib: true } }),
    )
    expect(r).toBeNull()
  })
})
