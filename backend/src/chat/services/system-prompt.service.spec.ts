import { Test, TestingModule } from '@nestjs/testing'
import type { ContextMedication, ResolvedContext } from '@cardioplace/shared'
import {
  SystemPromptService,
  type ChatAlertContext,
  type PatientContext,
} from './system-prompt.service.js'

// ─── fixtures ───────────────────────────────────────────────────────────────

const NOW = new Date('2026-04-22T10:00:00Z')
const DOB = new Date('1980-06-15T00:00:00Z')

function buildProfile(
  over: Partial<ResolvedContext['profile']> = {},
): ResolvedContext['profile'] {
  // Cast at the end — see notes in system-prompt-scenarios.spec.ts.
  return {
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
    hasAorticStenosis: false,
    diagnosedHypertension: false,
    verificationStatus: 'VERIFIED',
    verifiedAt: NOW,
    lastEditedAt: NOW,
    ...over,
  } as ResolvedContext['profile']
}

function buildMed(over: Partial<ContextMedication> = {}): ContextMedication {
  return {
    id: 'med-1',
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

function buildResolvedContext(
  over: {
    profile?: Partial<ResolvedContext['profile']>
    contextMeds?: ContextMedication[]
    excludedMeds?: ContextMedication[]
    threshold?: ResolvedContext['threshold']
    readingCount?: number
    preDay3Mode?: boolean
    personalizedEligible?: boolean
  } = {},
): ResolvedContext {
  const readingCount = over.readingCount ?? 10
  return {
    userId: 'user-1',
    dateOfBirth: DOB,
    timezone: 'America/New_York',
    ageGroup: '40-64',
    profile: buildProfile(over.profile),
    contextMeds: over.contextMeds ?? [],
    excludedMeds: over.excludedMeds ?? [],
    threshold: over.threshold ?? null,
    assignment: null,
    readingCount,
    preDay3Mode: over.preDay3Mode ?? readingCount < 7,
    personalizedEligible:
      over.personalizedEligible ?? (over.threshold != null && readingCount >= 7),
    pregnancyThresholdsActive: over.profile?.isPregnant ?? false,
    triggerPregnancyContraindicationCheck: over.profile?.isPregnant ?? false,
    enrolledAt: null,
    practiceName: null,
    patientName: null,
    resolvedAt: NOW,
  }
}

function buildContext(over: Partial<PatientContext> = {}): PatientContext {
  return {
    recentEntries: [],
    baseline: null,
    activeAlerts: [],
    communicationPreference: 'TEXT_FIRST',
    preferredLanguage: 'en',
    patientName: 'Jane Doe',
    dateOfBirth: DOB,
    resolvedContext: buildResolvedContext(),
    toneMode: 'PATIENT',
    ...over,
  }
}

function buildAlert(over: Partial<ChatAlertContext> = {}): ChatAlertContext {
  return {
    tier: 'BP_LEVEL_1_HIGH',
    ruleId: 'RULE_STANDARD_L1_HIGH',
    mode: 'STANDARD',
    patientMessage: 'Your BP is high, please contact your team.',
    physicianMessage: 'BP Level 1 High at 162/95.',
    dismissible: true,
    createdAt: NOW,
    ...over,
  }
}

// ─── suite ──────────────────────────────────────────────────────────────────

describe('SystemPromptService', () => {
  let service: SystemPromptService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SystemPromptService],
    }).compile()
    service = module.get(SystemPromptService)
  })

  // ==========================================================================
  // A.1 Profile / conditions rendering
  // ==========================================================================
  describe('A.1 conditions rendering', () => {
    it('no conditions → "No known cardiac conditions"', () => {
      const out = service.buildPatientContext(buildContext())
      expect(out).toContain('No known cardiac conditions')
    })

    it('HFrEF declared → "Heart failure (HFrEF)"', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            profile: {
              hasHeartFailure: true,
              heartFailureType: 'HFREF',
              resolvedHFType: 'HFREF',
            },
          }),
        }),
      )
      expect(out).toContain('Heart failure (HFrEF)')
    })

    it('HF type UNKNOWN → "managed as HFrEF" disclosure', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            profile: {
              hasHeartFailure: true,
              heartFailureType: 'UNKNOWN',
              resolvedHFType: 'HFREF',
            },
          }),
        }),
      )
      expect(out).toContain('type unknown — managed as HFrEF')
    })

    it('HFpEF declared → "Heart failure (HFpEF)"', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            profile: {
              hasHeartFailure: true,
              heartFailureType: 'HFPEF',
              resolvedHFType: 'HFPEF',
            },
          }),
        }),
      )
      expect(out).toContain('Heart failure (HFpEF)')
    })

    it('DCM only (no HF flag) → "Dilated cardiomyopathy (managed as HFrEF)"', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            profile: { hasHeartFailure: false, hasDCM: true, resolvedHFType: 'HFREF' },
          }),
        }),
      )
      expect(out).toContain('Dilated cardiomyopathy (managed as HFrEF)')
    })

    it('CAD + AFib + HCM → all three listed', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            profile: { hasCAD: true, hasAFib: true, hasHCM: true },
          }),
        }),
      )
      expect(out).toContain('Coronary artery disease (CAD)')
      expect(out).toContain('Atrial fibrillation (AFib)')
      expect(out).toContain('Hypertrophic cardiomyopathy (HCM)')
    })

    it('Tachycardia + bradycardia flags → listed', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            profile: { hasTachycardia: true, hasBradycardia: true },
          }),
        }),
      )
      expect(out).toContain('Tachycardia')
      expect(out).toContain('Bradycardia')
    })

    it('Diagnosed hypertension only → "Hypertension (on treatment)"', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            profile: { diagnosedHypertension: true },
          }),
        }),
      )
      expect(out).toContain('Hypertension (on treatment)')
    })
  })

  // ==========================================================================
  // A.2 Pregnancy rendering
  // ==========================================================================
  describe('A.2 pregnancy rendering', () => {
    it('pregnant + due date → date rendered', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            profile: {
              isPregnant: true,
              pregnancyDueDate: new Date('2026-08-15T00:00:00Z'),
            },
          }),
        }),
      )
      expect(out).toContain('Currently pregnant')
      expect(out).toContain('2026-08-15')
    })

    it('pregnant + no due date → just "Currently pregnant"', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            profile: { isPregnant: true, pregnancyDueDate: null },
          }),
        }),
      )
      expect(out).toContain('Currently pregnant')
    })

    it('preeclampsia history not pregnant → flag surfaces', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            profile: { isPregnant: false, historyHDP: true },
          }),
        }),
      )
      expect(out).toContain('History of hypertensive disorder of pregnancy (HDP)')
    })

    it('not pregnant + no history → neither line appears', () => {
      const out = service.buildPatientContext(buildContext())
      expect(out).not.toMatch(/pregnant/i)
      expect(out).not.toMatch(/preeclampsia/i)
    })
  })

  // ==========================================================================
  // A.3 Profile verification
  // ==========================================================================
  describe('A.3 verification status', () => {
    it('VERIFIED → no disclaimer', () => {
      const out = service.buildPatientContext(buildContext())
      expect(out).not.toContain('awaiting provider verification')
      expect(out).not.toContain('corrections applied')
    })

    it('UNVERIFIED → disclaimer surfaces', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            profile: { verificationStatus: 'UNVERIFIED' },
          }),
        }),
      )
      expect(out).toContain('awaiting provider verification')
    })

    it('CORRECTED → corrected disclaimer surfaces', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            profile: { verificationStatus: 'CORRECTED' },
          }),
        }),
      )
      expect(out).toContain('corrections applied')
    })
  })

  // ==========================================================================
  // A.4 Medication list
  // ==========================================================================
  describe('A.4 medication list', () => {
    it('empty contextMeds → "No medications recorded"', () => {
      const out = service.buildPatientContext(buildContext())
      expect(out).toContain('No medications recorded')
    })

    it('1 verified med → rendered with drug class + frequency', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            contextMeds: [buildMed()],
          }),
        }),
      )
      expect(out).toContain('Lisinopril (ACE_INHIBITOR)')
      expect(out).toContain('once daily')
    })

    it('3 verified meds → all three rendered', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            contextMeds: [
              buildMed({ drugName: 'Lisinopril' }),
              buildMed({ id: 'm2', drugName: 'Amlodipine', drugClass: 'DHP_CCB' }),
              buildMed({ id: 'm3', drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER' }),
            ],
          }),
        }),
      )
      expect(out).toContain('Lisinopril')
      expect(out).toContain('Amlodipine')
      expect(out).toContain('Metoprolol')
    })

    it('unverified known-class med → tagged "⚠ unverified"', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            contextMeds: [
              buildMed({
                drugClass: 'BETA_BLOCKER',
                drugName: 'Metoprolol',
                verificationStatus: 'UNVERIFIED',
              }),
            ],
          }),
        }),
      )
      expect(out).toContain('⚠ unverified')
    })

    it('combo med → rendered with component list', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            contextMeds: [
              buildMed({
                drugName: 'Entresto',
                drugClass: 'ARNI',
                isCombination: true,
                combinationComponents: ['ARNI', 'ARB'],
              }),
            ],
          }),
        }),
      )
      expect(out).toContain('Entresto')
      expect(out).toContain('combo: ARNI + ARB')
    })

    // ─── Bug 20 — pending-verification meds in the prompt ───────────────
    // Pre-fix, appendMedications rendered ONLY contextMeds. Meds in
    // excludedMeds (OTHER_UNVERIFIED, unreviewed voice/photo) never
    // reached the LLM, so the bot's per-med adherence question silently
    // skipped them. Now they land in a separate "pending verification"
    // section so the patient gets asked about ALL meds they self-reported,
    // while the rule engine still consumes only contextMeds.

    it('OTHER_UNVERIFIED med (patient self-added under "other") → rendered under pending section', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            contextMeds: [buildMed({ drugName: 'Lisinopril' })],
            excludedMeds: [
              buildMed({
                id: 'm-other',
                drugName: 'Glucosamine',
                drugClass: 'OTHER_UNVERIFIED',
                verificationStatus: 'UNVERIFIED',
              }),
            ],
          }),
        }),
      )
      // Active section still renders the known-class med.
      expect(out).toContain('Lisinopril (ACE_INHIBITOR)')
      // Pending section renders the "other"-category med so the LLM asks
      // about adherence; drug class is humanised to "unclassified".
      expect(out).toContain('Medications pending provider verification')
      expect(out).toContain('Glucosamine (unclassified)')
      expect(out).toContain('⚠ pending verification')
    })

    it('REJECTED med is hidden entirely (provider deliberately rejected — bot must not re-surface)', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            contextMeds: [buildMed({ drugName: 'Lisinopril' })],
            excludedMeds: [
              buildMed({
                id: 'm-rej',
                drugName: 'WrongDrug',
                drugClass: 'BETA_BLOCKER',
                verificationStatus: 'REJECTED',
              }),
            ],
          }),
        }),
      )
      expect(out).toContain('Lisinopril')
      expect(out).not.toContain('WrongDrug')
      // No pending header when the only excluded med is REJECTED.
      expect(out).not.toContain('Medications pending provider verification')
    })

    it('unreviewed voice-source med (AWAITING_PROVIDER) → surfaced in pending section', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            contextMeds: [],
            excludedMeds: [
              buildMed({
                id: 'm-voice',
                drugName: 'Atenolol',
                drugClass: 'BETA_BLOCKER',
                source: 'PATIENT_VOICE',
                verificationStatus: 'AWAITING_PROVIDER',
              }),
            ],
          }),
        }),
      )
      // No "No medications recorded" fallback even though contextMeds is empty.
      expect(out).not.toContain('No medications recorded')
      expect(out).toContain('Medications pending provider verification')
      expect(out).toContain('Atenolol (BETA_BLOCKER)')
      expect(out).toContain('⚠ pending verification')
    })
  })

  // ==========================================================================
  // A.5 PatientThreshold rendering
  // ==========================================================================
  describe('A.5 threshold rendering', () => {
    it('null threshold → effective standard goal 140/90 rendered (Round-3 Item C — no more "Provider has not yet set" fallback; the chat surface ALWAYS surfaces an effective goal so the bot quotes the same number the engine alerts on)', () => {
      const out = service.buildPatientContext(buildContext())
      expect(out).toContain('Effective BP goal: aim below 140/90 mmHg')
      // The old fallback wording must NOT appear — its removal is the point
      // of the Item C fix (a pregnant patient with no custom row used to
      // hear "no goal set" while the engine alerted at 140/90).
      expect(out).not.toContain('Provider has not yet set a personal BP goal')
    })

    it('full threshold → rendered with all axes', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            threshold: {
              sbpUpperTarget: 130,
              sbpLowerTarget: 90,
              dbpUpperTarget: 80,
              dbpLowerTarget: 60,
              hrUpperTarget: 100,
              hrLowerTarget: 50,
              setByProviderId: 'prov-1',
              setAt: new Date('2026-01-15T00:00:00Z'),
              notes: null,
            },
          }),
        }),
      )
      expect(out).toContain('SBP 90–130 mmHg')
      expect(out).toContain('DBP 60–80 mmHg')
      expect(out).toContain('HR 50–100 bpm')
      expect(out).toContain('set 2026-01-15')
    })

    it('partial threshold (SBP only) → renders just SBP line', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({
            threshold: {
              sbpUpperTarget: 130,
              sbpLowerTarget: 90,
              dbpUpperTarget: null,
              dbpLowerTarget: null,
              hrUpperTarget: null,
              hrLowerTarget: null,
              setByProviderId: 'prov-1',
              setAt: NOW,
              notes: null,
            },
          }),
        }),
      )
      expect(out).toContain('SBP 90–130 mmHg')
      expect(out).not.toContain('DBP')
      expect(out).not.toContain('HR ')
    })
  })

  // ==========================================================================
  // A.6 Active alerts (v2 shape)
  // ==========================================================================
  describe('A.6 active alerts', () => {
    it('no active alerts → "Active alerts: None"', () => {
      const out = service.buildPatientContext(buildContext())
      expect(out).toContain('Active alerts: None')
    })

    it('Tier 1 alert → tier + ruleId + verbatim patientMessage rendered', () => {
      const patientMessage =
        'Your care team needs to review your blood pressure medicine because you are pregnant.'
      const out = service.buildPatientContext(
        buildContext({
          activeAlerts: [
            buildAlert({
              tier: 'TIER_1_CONTRAINDICATION',
              ruleId: 'RULE_PREGNANCY_ACE_ARB',
              patientMessage,
              dismissible: false,
            }),
          ],
        }),
      )
      expect(out).toContain('TIER_1_CONTRAINDICATION')
      expect(out).toContain('RULE_PREGNANCY_ACE_ARB')
      expect(out).toContain(patientMessage)
      expect(out).toContain('NON-DISMISSABLE')
    })

    it('BP Level 2 alert → 911 CTA preserved from patientMessage', () => {
      const out = service.buildPatientContext(
        buildContext({
          activeAlerts: [
            buildAlert({
              tier: 'BP_LEVEL_2',
              ruleId: 'RULE_ABSOLUTE_EMERGENCY',
              patientMessage:
                'Your blood pressure is very high: 190/105 mmHg. If you have chest pain, severe headache, trouble breathing, weakness, or vision changes, call 911 now.',
              dismissible: false,
            }),
          ],
        }),
      )
      expect(out).toMatch(/call 911 now/)
    })

    it('Tier 3 info → physician-only note flagged "do NOT surface"', () => {
      const out = service.buildPatientContext(
        buildContext({
          activeAlerts: [
            buildAlert({
              tier: 'TIER_3_INFO',
              ruleId: 'RULE_PULSE_PRESSURE_WIDE',
              patientMessage: '',
              physicianMessage:
                'Tier 3 — Wide pulse pressure: 85 mmHg (>60) at 170/85 mmHg.',
              dismissible: true,
            }),
          ],
        }),
      )
      expect(out).toContain('do NOT surface to patient')
      expect(out).toContain('Wide pulse pressure')
    })

    it('orders by createdAt desc (most recent first)', () => {
      const older = new Date('2026-04-01T00:00:00Z')
      const newer = new Date('2026-04-20T00:00:00Z')
      const out = service.buildPatientContext(
        buildContext({
          activeAlerts: [
            buildAlert({
              ruleId: 'RULE_NEWER',
              patientMessage: 'newer msg',
              createdAt: newer,
            }),
            buildAlert({
              ruleId: 'RULE_OLDER',
              patientMessage: 'older msg',
              createdAt: older,
            }),
          ],
        }),
      )
      expect(out.indexOf('RULE_NEWER')).toBeLessThan(out.indexOf('RULE_OLDER'))
    })
  })

  // ==========================================================================
  // A.7 Pre-Day-3 disclaimer
  // ==========================================================================
  describe('A.7 pre-Day-3 disclaimer', () => {
    it('preDay3Mode=true → disclaimer appears with count', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({ readingCount: 3 }),
        }),
      )
      expect(out).toContain('fewer than 7 readings')
      expect(out).toContain('3 total')
    })

    it('preDay3Mode=false → line absent', () => {
      const out = service.buildPatientContext(
        buildContext({
          resolvedContext: buildResolvedContext({ readingCount: 10 }),
        }),
      )
      expect(out).not.toContain('fewer than 7 readings')
    })
  })

  // ==========================================================================
  // A.8 ToneMode scaffolding (in buildSystemPrompt)
  // ==========================================================================
  describe('A.8 tone mode scaffolding', () => {
    it('default PATIENT → warm plain-language directive', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain('TONE — patient mode')
      expect(out).toContain('warm, plain language')
    })

    it('CAREGIVER → caregiver directive', () => {
      const out = service.buildSystemPrompt({ toneMode: 'CAREGIVER' })
      expect(out).toContain('TONE — caregiver mode')
    })

    it('PHYSICIAN → clinical shorthand directive', () => {
      const out = service.buildSystemPrompt({ toneMode: 'PHYSICIAN' })
      expect(out).toContain('TONE — physician mode')
      expect(out).toContain('clinical shorthand')
    })
  })

  // ==========================================================================
  // B.1 Medication guardrails
  // ==========================================================================
  describe('B.1 medication guardrails', () => {
    it('includes stop/change prohibition', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain(
        'Never suggest starting, stopping, changing, or adjusting any medication',
      )
    })

    it('includes defer-to-provider directive', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain(
        "defer to the patient's provider for medication decisions",
      )
    })

    it('includes scripted refusal line', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain('please call your provider before changing anything')
    })
  })

  // ==========================================================================
  // B.2 Alert tier guardrails
  // ==========================================================================
  describe('B.2 alert tier guardrails', () => {
    it('includes "never contradict" directive', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain('Never contradict')
    })

    it('includes Tier 1 contact-provider directive', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain(
        'Tier 1 Contraindication',
      )
      expect(out).toContain('contact their provider today')
    })

    it('includes BP Level 2 call-911 directive', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain('BP Level 2 emergency')
      expect(out).toContain('call 911')
    })

    it('includes "patientMessage verbatim" directive', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain('use the alert\'s patientMessage verbatim')
    })
  })

  // ==========================================================================
  // B.3 Scope guardrails
  // ==========================================================================
  describe('B.3 scope guardrails', () => {
    it('includes "do not invent clinical advice"', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain('Do not invent new clinical advice')
    })

    it('includes "defer to provider if uncertain"', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain('defer to the provider')
    })
  })

  // ==========================================================================
  // Admin / null resolvedContext fallback
  // ==========================================================================
  describe('null resolvedContext fallback', () => {
    it('admin user (no PatientProfile) → "Clinical profile: not available"', () => {
      const out = service.buildPatientContext(
        buildContext({ resolvedContext: null }),
      )
      expect(out).toContain('Clinical profile: not available')
    })

    it('null resolvedContext → does NOT render condition/med/threshold sections', () => {
      const out = service.buildPatientContext(
        buildContext({ resolvedContext: null }),
      )
      expect(out).not.toContain('Cardiac conditions:')
      expect(out).not.toContain('Medications:')
      expect(out).not.toContain('Provider-set')
    })
  })

  // ==========================================================================
  // Phase/16 — enrollment status + open AWAITING context lines
  // (Nivakaran chat-v2 handoff 2026-06-17)
  // ==========================================================================
  describe('Phase/16 enrollment status', () => {
    it('NOT_ENROLLED → renders care-team-pending wording in context', () => {
      const out = service.buildPatientContext(
        buildContext({ enrollmentStatus: 'NOT_ENROLLED' }),
      )
      expect(out).toContain('Enrollment status: NOT_ENROLLED')
      expect(out).toContain('once enrollment is complete')
    })

    it('ENROLLED → renders actively-reviewing wording in context', () => {
      const out = service.buildPatientContext(
        buildContext({ enrollmentStatus: 'ENROLLED' }),
      )
      expect(out).toContain('Enrollment status: ENROLLED')
      expect(out).toContain('actively reviewing')
    })

    it('null/undefined enrollmentStatus → no enrollment line emitted', () => {
      const out = service.buildPatientContext(buildContext({ enrollmentStatus: null }))
      expect(out).not.toContain('Enrollment status:')
    })
  })

  describe('Phase/16 open AWAITING entry', () => {
    it('open AWAITING surfaced → renders BP + id + resume instruction', () => {
      const out = service.buildPatientContext(
        buildContext({
          openAwaiting: {
            id: 'await-1',
            systolicBP: 195,
            diastolicBP: 122,
            measuredAt: new Date('2026-06-17T14:32:00.000Z'),
          },
        }),
      )
      expect(out).toContain('Open AWAITING entry:')
      expect(out).toContain('195/122')
      expect(out).toContain('id=await-1')
      expect(out).toContain('confirmatory')
    })

    it('null openAwaiting → no AWAITING line emitted', () => {
      const out = service.buildPatientContext(buildContext({ openAwaiting: null }))
      expect(out).not.toContain('Open AWAITING entry:')
    })

    it('openAwaiting with null BP fields → no AWAITING line emitted (defensive)', () => {
      const out = service.buildPatientContext(
        buildContext({
          openAwaiting: {
            id: 'await-2',
            systolicBP: null,
            diastolicBP: null,
            measuredAt: NOW,
          },
        }),
      )
      expect(out).not.toContain('Open AWAITING entry:')
    })
  })

  describe('Phase/16 alignment block (Items 1–7) — present in V1 prompt', () => {
    it('verbal confirmation gate (Item 1) appears in the assembled system prompt', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain('VERBAL CONFIRMATION GATE')
      expect(out).toContain('verbalise the values back')
    })

    it('Option D AWAITING flow (Item 2) appears with decline + resume guidance', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain('OPTION D — EMERGENCY-RANGE CONFIRMATORY FLOW')
      expect(out).toContain('confirms_entry_id')
      expect(out).toContain('decline_confirmation')
      expect(out).toContain('RULE_UNCONFIRMED_EMERGENCY')
    })

    it('symptom-override 911 rule (Item 3) appears with the verbatim 911 line', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain('SYMPTOM-OVERRIDE 911')
      expect(out).toContain('Please call 911 now')
      expect(out).toContain('chest_pain_or_dyspnea')
    })

    it('Q3 multi-reading session (Item 4) appears with AFib proactive prompt', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain('Q3 MULTI-READING SESSION')
      expect(out).toContain('AFib')
      expect(out).toContain('session_id')
    })

    it('edit-window guidance (Item 5) appears with 5-min boundary + flag_reading_error fallback', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain('EDIT WINDOW')
      expect(out).toContain('5 minutes')
      expect(out).toContain('flag_reading_error')
    })

    it('enrollment-aware messaging (Item 6) names both branches', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain('ENROLLMENT-AWARE MESSAGING')
      expect(out).toContain('NOT_ENROLLED')
      expect(out).toContain('ENROLLED')
    })

    it('session boundary (Item 7) describes close_session per use case', () => {
      const out = service.buildSystemPrompt()
      expect(out).toContain('SESSION BOUNDARY')
      expect(out).toContain('close_session')
      expect(out).toContain('AWAITING')
    })
  })
})
