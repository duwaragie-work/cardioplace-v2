// Phase/5 pure-function rule coverage — matches the test matrix (§D–§R) in
// the approved plan. No Prisma, no Nest — every rule function takes
// (session, ctx) and returns RuleResult | null.

import {
  getAgeGroup,
  type ContextMedication,
  type ResolvedContext,
} from '@cardioplace/shared'
import {
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
  cadRule,
  dcmRule,
  hcmRule,
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
import { afibHrRule, bradyRule, buildTachyRule } from './hr-branches.js'
import { pulsePressureWideRule } from './pulse-pressure.js'
import { loopDiureticHypotensionRule } from './loop-diuretic.js'
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
    readingCount: 1,
    symptoms: noSymptoms(),
    suboptimalMeasurement: false,
    sessionId: null,
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
    historyPreeclampsia: false,
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
describe('cadRule (J)', () => {
  const cadctx = ctx({ profile: { hasCAD: true } })

  it('CAD + DBP=69 → DBP-Critical Low', () => {
    const r = cadRule(session({ systolicBP: 140, diastolicBP: 69 }), cadctx)
    expect(r?.tier).toBe('BP_LEVEL_1_LOW')
    expect(r?.ruleId).toBe('RULE_CAD_DBP_CRITICAL')
  })

  it('CAD + DBP=70 → no alert (boundary)', () => {
    expect(
      cadRule(session({ systolicBP: 140, diastolicBP: 70 }), cadctx),
    ).toBeNull()
  })

  it('CAD + DBP=60 + SBP=105 → DBP-Critical (regardless of SBP)', () => {
    const r = cadRule(session({ systolicBP: 105, diastolicBP: 60 }), cadctx)
    expect(r?.ruleId).toBe('RULE_CAD_DBP_CRITICAL')
  })

  it('CAD + SBP=160 DBP=85 → L1 High', () => {
    const r = cadRule(session({ systolicBP: 160, diastolicBP: 85 }), cadctx)
    expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
  })
})

// ─── K. HCM ─────────────────────────────────────────────────────────────────
describe('hcmRule (K)', () => {
  const hcmctx = ctx({ profile: { hasHCM: true } })

  it('SBP=99 → L1 Low (<100)', () => {
    const r = hcmRule(session({ systolicBP: 99 }), hcmctx)
    expect(r?.tier).toBe('BP_LEVEL_1_LOW')
    expect(r?.ruleId).toBe('RULE_HCM_LOW')
  })

  it('SBP=100 → no alert (boundary)', () => {
    expect(hcmRule(session({ systolicBP: 100 }), hcmctx)).toBeNull()
  })

  it('HCM + vasodilator nitrate → Tier 3 safety flag', () => {
    const r = hcmRule(
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
    const r = hcmRule(
      session({ systolicBP: 120 }),
      ctx({
        profile: { hasHCM: true },
        contextMeds: [med({ drugName: 'Amlodipine', drugClass: 'DHP_CCB' })],
      }),
    )
    expect(r?.tier).toBe('TIER_3_INFO')
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

describe('tachy rule (P)', () => {
  const tctx = ctx({ profile: { hasTachycardia: true } })

  it('single elevated (prior=false) → no alert', () => {
    const rule = buildTachyRule(false)
    expect(rule(session({ pulse: 105 }), tctx)).toBeNull()
  })

  it('elevated + prior=true → alert', () => {
    const rule = buildTachyRule(true)
    const r = rule(session({ pulse: 105 }), tctx)
    expect(r?.tier).toBe('BP_LEVEL_1_HIGH')
    expect(r?.ruleId).toBe('RULE_TACHY_HR')
  })
})

describe('bradyRule (P)', () => {
  const bctx = ctx({ profile: { hasBradycardia: true } })

  it('HR=48 + chestPain → symptomatic L1', () => {
    const r = bradyRule(
      session({
        pulse: 48,
        symptoms: { ...noSymptoms(), chestPainOrDyspnea: true },
      }),
      bctx,
    )
    expect(r?.tier).toBe('BP_LEVEL_1_LOW')
    expect(r?.ruleId).toBe('RULE_BRADY_HR_SYMPTOMATIC')
  })

  it('HR=38 asymptomatic → L1 regardless', () => {
    const r = bradyRule(session({ pulse: 38 }), bctx)
    expect(r?.ruleId).toBe('RULE_BRADY_HR_ASYMPTOMATIC')
  })

  it('HR=55 → no alert', () => {
    expect(bradyRule(session({ pulse: 55 }), bctx)).toBeNull()
  })

  it('beta-blocker + HR=55 → suppressed', () => {
    const r = bradyRule(
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
    const r = bradyRule(
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
describe('loopDiureticHypotensionRule (R)', () => {
  const lctx = ctx({
    contextMeds: [med({ drugName: 'Furosemide', drugClass: 'LOOP_DIURETIC' })],
  })

  it('loop + SBP=92 → Tier 3 note', () => {
    const r = loopDiureticHypotensionRule(session({ systolicBP: 92 }), lctx)
    expect(r?.tier).toBe('TIER_3_INFO')
  })

  it('loop + SBP=100 → no alert', () => {
    expect(
      loopDiureticHypotensionRule(session({ systolicBP: 100 }), lctx),
    ).toBeNull()
  })

  it('loop + SBP=88 → delegates to standard L1 Low (no double alert)', () => {
    expect(
      loopDiureticHypotensionRule(session({ systolicBP: 88 }), lctx),
    ).toBeNull()
  })
})
