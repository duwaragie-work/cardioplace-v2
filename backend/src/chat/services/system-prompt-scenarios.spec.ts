// End-to-end rendering scenarios — seed-archetype-shaped fixtures. Each case
// builds a realistic PatientContext (profile + meds + alerts + readings) and
// asserts the full system prompt + patient context contain the expected
// substrings. Companion to alert-engine.scenarios.spec.ts: where that spec
// asserts alert outcomes, this one asserts what the chatbot actually sees.

import { Test, TestingModule } from '@nestjs/testing'
import type { ContextMedication, ResolvedContext } from '@cardioplace/shared'
import {
  SystemPromptService,
  type ChatAlertContext,
  type PatientContext,
} from './system-prompt.service.js'

const NOW = new Date('2026-04-22T10:00:00Z')
const DOB = new Date('1980-06-15T00:00:00Z')

function profile(
  over: Partial<ResolvedContext['profile']> = {},
): ResolvedContext['profile'] {
  return {
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
    verifiedAt: NOW,
    lastEditedAt: NOW,
    ...over,
  }
}

function med(over: Partial<ContextMedication> = {}): ContextMedication {
  return {
    id: 'm',
    drugName: 'Lisinopril',
    drugClass: 'ACE_INHIBITOR',
    isCombination: false,
    combinationComponents: [],
    frequency: 'ONCE_DAILY',
    source: 'PATIENT_SELF_REPORT',
    verificationStatus: 'VERIFIED',
    reportedAt: NOW,
    ...over,
  }
}

function ctx(over: {
  profile?: Partial<ResolvedContext['profile']>
  contextMeds?: ContextMedication[]
  threshold?: ResolvedContext['threshold']
  readingCount?: number
} = {}): ResolvedContext {
  const readingCount = over.readingCount ?? 10
  return {
    userId: 'u',
    dateOfBirth: DOB,
    timezone: 'America/New_York',
    ageGroup: '40-64',
    profile: profile(over.profile),
    contextMeds: over.contextMeds ?? [],
    excludedMeds: [],
    threshold: over.threshold ?? null,
    assignment: null,
    readingCount,
    preDay3Mode: readingCount < 7,
    personalizedEligible: over.threshold != null && readingCount >= 7,
    pregnancyThresholdsActive: over.profile?.isPregnant ?? false,
    triggerPregnancyContraindicationCheck: over.profile?.isPregnant ?? false,
    resolvedAt: NOW,
  }
}

function alert(over: Partial<ChatAlertContext> = {}): ChatAlertContext {
  return {
    tier: 'BP_LEVEL_1_HIGH',
    ruleId: 'RULE_STANDARD_L1_HIGH',
    mode: 'STANDARD',
    patientMessage: '',
    physicianMessage: '',
    dismissible: true,
    createdAt: NOW,
    ...over,
  }
}

function patientContext(over: Partial<PatientContext> = {}): PatientContext {
  return {
    recentEntries: [],
    baseline: null,
    activeAlerts: [],
    communicationPreference: 'TEXT_FIRST',
    preferredLanguage: 'en',
    patientName: 'Test Patient',
    dateOfBirth: DOB,
    resolvedContext: ctx(),
    toneMode: 'PATIENT',
    ...over,
  }
}

describe('SystemPromptService — end-to-end rendering scenarios', () => {
  let service: SystemPromptService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SystemPromptService],
    }).compile()
    service = module.get(SystemPromptService)
  })

  function render(pc: PatientContext): string {
    return (
      service.buildSystemPrompt({ toneMode: pc.toneMode }) +
      '\n\n' +
      service.buildPatientContext(pc)
    )
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Seed archetypes
  // ──────────────────────────────────────────────────────────────────────────

  it('Scenario 1 — Priya-shape (pregnant + ACE + active Tier 1)', () => {
    const priyaMessage =
      'Your care team needs to review your blood pressure medicine because you are pregnant. Please call your provider today before taking your next dose.'
    const out = render(
      patientContext({
        patientName: 'Priya Menon',
        resolvedContext: ctx({
          profile: { isPregnant: true, historyPreeclampsia: true },
          contextMeds: [med({ drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR' })],
        }),
        activeAlerts: [
          alert({
            tier: 'TIER_1_CONTRAINDICATION',
            ruleId: 'RULE_PREGNANCY_ACE_ARB',
            patientMessage: priyaMessage,
            dismissible: false,
          }),
        ],
      }),
    )

    expect(out).toContain('Currently pregnant')
    expect(out).toContain('Lisinopril (ACE_INHIBITOR)')
    expect(out).toContain('TIER_1_CONTRAINDICATION')
    expect(out).toContain('NON-DISMISSABLE')
    expect(out).toContain(priyaMessage)
    // Guardrails always present
    expect(out).toContain(
      'Never suggest starting, stopping, changing, or adjusting any medication',
    )
  })

  it('Scenario 2 — James-shape (HFrEF + diltiazem + active Tier 1)', () => {
    const jamesMessage =
      'Your care team needs to review one of your heart medicines with you. Please call your provider today before taking your next dose.'
    const out = render(
      patientContext({
        patientName: 'James Okafor',
        resolvedContext: ctx({
          profile: {
            hasHeartFailure: true,
            heartFailureType: 'HFREF',
            resolvedHFType: 'HFREF',
          },
          contextMeds: [
            med({ drugName: 'Diltiazem', drugClass: 'NDHP_CCB' }),
            med({ id: 'm2', drugName: 'Carvedilol', drugClass: 'BETA_BLOCKER' }),
          ],
        }),
        activeAlerts: [
          alert({
            tier: 'TIER_1_CONTRAINDICATION',
            ruleId: 'RULE_NDHP_HFREF',
            patientMessage: jamesMessage,
            dismissible: false,
          }),
        ],
      }),
    )

    expect(out).toContain('Heart failure (HFrEF)')
    expect(out).toContain('Diltiazem (NDHP_CCB)')
    expect(out).toContain('Carvedilol (BETA_BLOCKER)')
    expect(out).toContain(jamesMessage)
  })

  it('Scenario 3 — Rita-shape (CAD + DBP 68 + BP L1 Low critical)', () => {
    const ritaMessage =
      'Your blood pressure reading is 132/68 mmHg. The lower number is concerning for your heart. Please contact your care team today.'
    const out = render(
      patientContext({
        patientName: 'Rita Washington',
        resolvedContext: ctx({
          profile: { hasCAD: true, diagnosedHypertension: true },
          contextMeds: [
            med({ drugName: 'Amlodipine', drugClass: 'DHP_CCB' }),
            med({ id: 'm2', drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER' }),
            med({ id: 'm3', drugName: 'Atorvastatin', drugClass: 'STATIN' }),
          ],
        }),
        activeAlerts: [
          alert({
            tier: 'BP_LEVEL_1_LOW',
            ruleId: 'RULE_CAD_DBP_CRITICAL',
            patientMessage: ritaMessage,
          }),
        ],
      }),
    )

    expect(out).toContain('Coronary artery disease (CAD)')
    expect(out).toContain('BP_LEVEL_1_LOW')
    expect(out).toContain('RULE_CAD_DBP_CRITICAL')
    expect(out).toContain(ritaMessage)
  })

  it('Scenario 4 — Charles-shape (AFib + HR 115 + BP L1 High)', () => {
    const out = render(
      patientContext({
        patientName: 'Charles Brown',
        resolvedContext: ctx({
          profile: { hasAFib: true },
          contextMeds: [
            med({ drugName: 'Apixaban', drugClass: 'ANTICOAGULANT' }),
            med({ id: 'm2', drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER' }),
          ],
        }),
        activeAlerts: [
          alert({
            tier: 'BP_LEVEL_1_HIGH',
            ruleId: 'RULE_AFIB_HR_HIGH',
            patientMessage:
              'Your heart rate is HR 115 bpm, which is higher than your goal. Please contact your care team today.',
          }),
        ],
      }),
    )

    expect(out).toContain('Atrial fibrillation (AFib)')
    expect(out).toContain('Apixaban (ANTICOAGULANT)')
    expect(out).toContain('RULE_AFIB_HR_HIGH')
    expect(out).toContain('HR 115 bpm')
  })

  it('Scenario 5 — Aisha-shape (controlled HTN, no active alerts)', () => {
    const out = render(
      patientContext({
        patientName: 'Aisha Johnson',
        resolvedContext: ctx({
          profile: { diagnosedHypertension: true },
          contextMeds: [
            med({ drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR' }),
            med({ id: 'm2', drugName: 'Amlodipine', drugClass: 'DHP_CCB' }),
          ],
        }),
        activeAlerts: [],
      }),
    )

    expect(out).toContain('Hypertension (on treatment)')
    expect(out).toContain('Lisinopril (ACE_INHIBITOR)')
    expect(out).toContain('Amlodipine (DHP_CCB)')
    expect(out).toContain('Active alerts: None')
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Edge paths
  // ──────────────────────────────────────────────────────────────────────────

  it('Scenario 6 — Unverified pregnant + ACE (safety net)', () => {
    const out = render(
      patientContext({
        resolvedContext: ctx({
          profile: {
            isPregnant: true,
            verificationStatus: 'UNVERIFIED',
          },
          contextMeds: [
            med({
              drugName: 'Lisinopril',
              verificationStatus: 'UNVERIFIED',
            }),
          ],
        }),
        activeAlerts: [
          alert({
            tier: 'TIER_1_CONTRAINDICATION',
            ruleId: 'RULE_PREGNANCY_ACE_ARB',
            patientMessage: 'pregnancy + ACE contraindication',
            dismissible: false,
          }),
        ],
      }),
    )

    expect(out).toContain('awaiting provider verification')
    expect(out).toContain('⚠ unverified')
    expect(out).toContain('RULE_PREGNANCY_ACE_ARB')
  })

  it('Scenario 7 — Pre-Day-3 patient (3 readings)', () => {
    const out = render(
      patientContext({
        resolvedContext: ctx({ readingCount: 3 }),
      }),
    )
    expect(out).toContain('fewer than 7 readings')
    expect(out).toContain('3 total')
    expect(out).toContain('personalization begins after Day 3')
  })

  it('Scenario 8 — Alert cap: 8 alerts provided → renders all (capping is caller-side)', () => {
    // buildPatientContext does NOT cap — the cap is enforced upstream by
    // chat.service.ts via Prisma take:5. This scenario confirms the renderer
    // passes through whatever the caller supplies. See chat.service.spec.ts
    // for the enforcement of take:5.
    const many = Array.from({ length: 8 }, (_, i) =>
      alert({
        ruleId: `RULE_${i}`,
        patientMessage: `msg ${i}`,
        createdAt: new Date(`2026-04-${10 + i}T00:00:00Z`),
      }),
    )
    const out = render(patientContext({ activeAlerts: many }))
    expect(out).toContain('Active alerts (8, most recent first)')
  })

  it('Scenario 9 — Tier 3 wide-PP alert → physician-only note flagged', () => {
    const out = render(
      patientContext({
        activeAlerts: [
          alert({
            tier: 'TIER_3_INFO',
            ruleId: 'RULE_PULSE_PRESSURE_WIDE',
            patientMessage: '',
            physicianMessage:
              'Tier 3 — Wide pulse pressure: 85 mmHg (>60) at 170/85 mmHg.',
          }),
        ],
      }),
    )
    expect(out).toContain('do NOT surface to patient')
    expect(out).toContain('Wide pulse pressure')
  })

  it('Scenario 10 — Admin user (no resolvedContext) → minimal prompt, no condition section', () => {
    const out = render(
      patientContext({
        patientName: 'Admin User',
        resolvedContext: null,
      }),
    )
    expect(out).toContain('Clinical profile: not available')
    expect(out).not.toContain('Cardiac conditions:')
    expect(out).not.toContain('Medications:')
    expect(out).not.toContain('Provider-set')
    // Guardrails still present
    expect(out).toContain('Never suggest starting, stopping')
  })
})
