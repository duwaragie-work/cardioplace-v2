// Cross-surface parity tests for text-chat and voice-chat tools.
//
// These tests are wiring-correctness assertions, not behavior tests. They
// answer questions like:
//   • Does every tool the text chat declares also exist on voice (or have a
//     documented reason not to)?
//   • Do the submit_checkin schemas accept the same symptom keys on both
//     surfaces? (Critical: a patient reporting angioedema by voice must be
//     able to submit it — Cluster 8 P0.)
//   • Are all 8 text tools dispatched by executeJournalTool?
//   • Are all 5 voice tools dispatched by VoiceToolsService.dispatch?
//
// Run via:
//   NODE_OPTIONS=--experimental-vm-modules \
//     npx jest --testPathPatterns="chat-voice-parity"

import { jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import {
  executeJournalTool,
  getJournalToolDeclarations,
} from './journal-tools.js'
import { VoiceToolsService } from '../../voice/tools/voice-tools.service.js'
import { IntakeStatusService } from '../../intake/intake-status.service.js'
import { DailyJournalService } from '../../daily_journal/daily_journal.service.js'
import { AlertEngineService } from '../../daily_journal/services/alert-engine.service.js'
import { GeminiService } from '../../gemini/gemini.service.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { EventEmitter2 } from '@nestjs/event-emitter'

// ─── Text-chat tool catalog ───────────────────────────────────────────────────

const TEXT_TOOLS_EXPECTED = [
  'submit_checkin',
  'get_recent_readings',
  'update_checkin',
  'delete_checkin',
  'log_medication_adherence',
  'log_symptom_quick',
  'submit_bp_from_photo',
  'flag_emergency',
  'evaluate_reading',
  'finalize_checkin',
  'check_intake_status',
] as const

const VOICE_TOOLS_EXPECTED = [
  'submit_checkin',
  'get_recent_readings',
  'update_checkin',
  'delete_checkin',
  'submit_bp_from_photo',
  'evaluate_reading',
  'finalize_checkin',
  'check_intake_status',
  'flag_emergency',
] as const

// Symptoms declared on the text-chat `submit_checkin` schema.
// Anchored to the same Cluster 6/7/8 surface the CheckIn UI ships.
const ALL_STRUCTURED_SYMPTOM_KEYS = [
  // Original Level-2 set (9)
  'severeHeadache',
  'visualChanges',
  'alteredMentalStatus',
  'chestPainOrDyspnea',
  'focalNeuroDeficit',
  'severeEpigastricPain',
  'newOnsetHeadache',
  'ruqPain',
  'edema',
  // Cluster 6 — brady-symptomatic, HF-decomp, palpitations
  'dizziness',
  'syncope',
  'palpitations',
  'legSwelling',
  // Cluster 7 — Appendix A side effects
  'fatigue',
  'shortnessOfBreath',
  'dryCough',
  'nsaidUse',
  // Cluster 8 (P0) — ACE-angioedema airway emergency
  'faceSwelling',
  'throatTightness',
] as const

// Camel-to-snake conversion to compare schemas (text uses snake_case keys
// like `severe_headache`; voice mirrors that convention).
function snakeOf(camel: string): string {
  return camel.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
}

// ─── 1. Catalog parity ────────────────────────────────────────────────────────

describe('Chat ↔ Voice tool catalog parity', () => {
  it('text-chat exposes the canonical 11-tool catalog', () => {
    const decls = getJournalToolDeclarations()
    const names = decls.map((d) => d.name).sort()
    expect(names).toEqual([...TEXT_TOOLS_EXPECTED].sort())
  })

  it('voice-chat exposes the canonical 9-tool catalog', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        VoiceToolsService,
        { provide: DailyJournalService, useValue: {} },
        { provide: GeminiService, useValue: {} },
        { provide: AlertEngineService, useValue: {} },
        { provide: IntakeStatusService, useValue: { getStatus: async () => ({ completed: true, profileExists: true }) } },
        { provide: PrismaService, useValue: { emergencyEvent: { create: async () => ({}) } } },
        { provide: EventEmitter2, useValue: { emit: () => {} } },
      ],
    }).compile()
    const svc = moduleRef.get(VoiceToolsService)
    const names = svc.getToolDeclarations().map((d) => d.name).sort()
    expect(names).toEqual([...VOICE_TOOLS_EXPECTED].sort())
  })

  it('every voice tool is also a text tool (voice ⊆ text)', () => {
    const textNames = new Set(getJournalToolDeclarations().map((d) => d.name))
    for (const voiceName of VOICE_TOOLS_EXPECTED) {
      expect(textNames).toContain(voiceName)
    }
  })

  // KNOWN GAP — voice does NOT have these three tools today. The voice V2
  // system prompt routes the symptom case through sparse-submit_checkin
  // instead, and the adherence case the same way. flag_emergency has no
  // voice analog at all — voice handles emergencies inline via speech
  // without persisting an EmergencyEvent row. Test documents the gap;
  // remove the `expected` array when voice gains the missing tools.
  // Bug 12 (2026-06) — flag_emergency now exists on voice. Updated the
  // expected text-only set to the remaining two (log_medication_adherence
  // and log_symptom_quick).
  it('documents the text-only tools (voice gap)', () => {
    const textOnly: string[] = []
    const voiceNames = new Set<string>(VOICE_TOOLS_EXPECTED)
    for (const t of TEXT_TOOLS_EXPECTED) {
      if (!voiceNames.has(t)) textOnly.push(t)
    }
    expect(textOnly.sort()).toEqual(
      ['log_medication_adherence', 'log_symptom_quick'].sort(),
    )
  })
})

// ─── 2. submit_checkin schema parity ──────────────────────────────────────────

describe('submit_checkin schema parity (text vs voice)', () => {
  it('text-chat submit_checkin accepts the original 9 Stage A symptom booleans', () => {
    // Discovered 2026-05 during this audit: text-chat submit_checkin
    // ONLY declares the 9 Stage A symptom keys. Cluster 6/7/8 symptoms
    // (dizziness, syncope, palpitations, legSwelling, fatigue,
    // shortnessOfBreath, dryCough, nsaidUse, faceSwelling, throatTightness)
    // are routed through log_symptom_quick instead, OR through the
    // freeform `symptoms[]` array which the engine does not pattern-match.
    // The next test asserts the gap explicitly.
    const submit = getJournalToolDeclarations().find(
      (d) => d.name === 'submit_checkin',
    )
    expect(submit).toBeDefined()
    const props = submit!.parameters?.properties as Record<string, unknown>
    const STAGE_A = [
      'severeHeadache',
      'visualChanges',
      'alteredMentalStatus',
      'chestPainOrDyspnea',
      'focalNeuroDeficit',
      'severeEpigastricPain',
      'newOnsetHeadache',
      'ruqPain',
      'edema',
    ]
    for (const key of STAGE_A) {
      expect(props).toHaveProperty(snakeOf(key))
    }
  })

  it('GAP — text-chat submit_checkin is MISSING Cluster 6/7/8 symptom keys', () => {
    // The text-chat `submit_checkin` schema does NOT declare these,
    // even though the engine consumes them on the JournalEntry. A patient
    // saying "I have leg swelling and felt dizzy" during a full check-in
    // can only have those captured via the legacy `symptoms[]` string
    // array (which the engine does NOT use for rule evaluation) — the
    // model has no way to set the structured booleans during a
    // submit_checkin call. Cluster 6/7/8 routing relies on
    // log_symptom_quick instead.
    const submit = getJournalToolDeclarations().find(
      (d) => d.name === 'submit_checkin',
    )
    const props = submit!.parameters?.properties as Record<string, unknown>
    const MISSING_FROM_SUBMIT = [
      'dizziness',
      'syncope',
      'palpitations',
      'legSwelling',
      'fatigue',
      'shortnessOfBreath',
      'dryCough',
      'nsaidUse',
      'faceSwelling',
      'throatTightness',
    ]
    const absent = MISSING_FROM_SUBMIT
      .filter((k) => !(snakeOf(k) in props))
      .map(snakeOf)
    expect(absent.sort()).toEqual(
      MISSING_FROM_SUBMIT.map(snakeOf).sort(),
    )
  })

  it('log_symptom_quick covers ALL 19 symptom keys (text-chat\'s actual Cluster 6/7/8 entry point)', () => {
    const quick = getJournalToolDeclarations().find(
      (d) => d.name === 'log_symptom_quick',
    )
    expect(quick).toBeDefined()
    const symptomEnumDoc =
      (
        (quick!.parameters?.properties as Record<string, { description?: string }>)
          ?.symptom?.description ?? ''
      ).toLowerCase()
    for (const key of ALL_STRUCTURED_SYMPTOM_KEYS) {
      expect(symptomEnumDoc).toContain(key.toLowerCase())
    }
  })

  it('voice-chat submit_checkin schema is documented and audited', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        VoiceToolsService,
        { provide: DailyJournalService, useValue: {} },
        { provide: GeminiService, useValue: {} },
        { provide: AlertEngineService, useValue: {} },
        { provide: IntakeStatusService, useValue: { getStatus: async () => ({ completed: true, profileExists: true }) } },
        { provide: PrismaService, useValue: { emergencyEvent: { create: async () => ({}) } } },
        { provide: EventEmitter2, useValue: { emit: () => {} } },
      ],
    }).compile()
    const svc = moduleRef.get(VoiceToolsService)
    const submit = svc.getToolDeclarations().find(
      (d) => d.name === 'submit_checkin',
    )
    const props = (submit!.parameters!.properties ?? {}) as Record<string, unknown>

    // Voice schema MUST accept the original 9 Level-2 symptoms + Cluster 6
    // brady/HF/palpitation flags — these are the minimum for the engine
    // to fire emergency overrides.
    const VOICE_REQUIRED = [
      'severe_headache',
      'visual_changes',
      'altered_mental_status',
      'chest_pain_or_dyspnea',
      'focal_neuro_deficit',
      'severe_epigastric_pain',
      'new_onset_headache',
      'ruq_pain',
      'edema',
      // Cluster 6
      'dizziness',
      'syncope',
      'palpitations',
      'leg_swelling',
    ]
    for (const key of VOICE_REQUIRED) {
      expect(props).toHaveProperty(key)
    }
  })

  it('GAP — voice submit_checkin is MISSING Cluster 7 (Appendix A) symptoms', async () => {
    // Cluster 7 BB / ACE side-effect symptoms are not in voice's schema.
    // A voice patient reporting fatigue/SOB/dryCough on a beta-blocker
    // cannot trigger the Cluster 7 side-effect rules.
    const moduleRef = await Test.createTestingModule({
      providers: [
        VoiceToolsService,
        { provide: DailyJournalService, useValue: {} },
        { provide: GeminiService, useValue: {} },
        { provide: AlertEngineService, useValue: {} },
        { provide: IntakeStatusService, useValue: { getStatus: async () => ({ completed: true, profileExists: true }) } },
        { provide: PrismaService, useValue: { emergencyEvent: { create: async () => ({}) } } },
        { provide: EventEmitter2, useValue: { emit: () => {} } },
      ],
    }).compile()
    const svc = moduleRef.get(VoiceToolsService)
    const submit = svc.getToolDeclarations().find(
      (d) => d.name === 'submit_checkin',
    )
    const props = (submit!.parameters!.properties ?? {}) as Record<string, unknown>

    const CLUSTER_7 = ['fatigue', 'shortness_of_breath', 'dry_cough', 'nsaid_use']
    const missingC7 = CLUSTER_7.filter((k) => !(k in props))
    expect(missingC7.sort()).toEqual(CLUSTER_7.sort())
  })

  it('voice submit_checkin DOES expose Cluster 8 (ACE-angioedema) airway-emergency symptoms', async () => {
    // Closed 2026-05-20 — the P0 angioedema pilot blocker on the voice
    // surface is resolved: face_swelling + throat_tightness booleans
    // accepted, dispatched to the rule engine via faceSwelling /
    // throatTightness on the JournalEntry DTO. Cluster 7 (BB/ACE side
    // effects) is still deferred pending Manisha sign-off.
    const moduleRef = await Test.createTestingModule({
      providers: [
        VoiceToolsService,
        { provide: DailyJournalService, useValue: {} },
        { provide: GeminiService, useValue: {} },
        { provide: AlertEngineService, useValue: {} },
        { provide: IntakeStatusService, useValue: { getStatus: async () => ({ completed: true, profileExists: true }) } },
        { provide: PrismaService, useValue: { emergencyEvent: { create: async () => ({}) } } },
        { provide: EventEmitter2, useValue: { emit: () => {} } },
      ],
    }).compile()
    const svc = moduleRef.get(VoiceToolsService)
    const submit = svc.getToolDeclarations().find(
      (d) => d.name === 'submit_checkin',
    )
    const props = (submit!.parameters!.properties ?? {}) as Record<string, unknown>

    expect(props).toHaveProperty('face_swelling')
    expect(props).toHaveProperty('throat_tightness')
  })

  it('voice submit_checkin dispatch threads faceSwelling/throatTightness into the journal DTO', async () => {
    // End-to-end: model call → dispatcher → DailyJournalService.create DTO.
    const dailyJournal = {
      create: jest.fn<any>().mockResolvedValue({}),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    }
    const gemini = { extractBpFromImage: jest.fn() }
    const moduleRef = await Test.createTestingModule({
      providers: [
        VoiceToolsService,
        { provide: DailyJournalService, useValue: dailyJournal },
        { provide: GeminiService, useValue: gemini },
        { provide: AlertEngineService, useValue: {} },
        { provide: IntakeStatusService, useValue: { getStatus: async () => ({ completed: true, profileExists: true }) } },
        { provide: PrismaService, useValue: { emergencyEvent: { create: async () => ({}) } } },
        { provide: EventEmitter2, useValue: { emit: () => {} } },
      ],
    }).compile()
    const svc = moduleRef.get(VoiceToolsService)
    await svc.dispatch(
      'submit_checkin',
      {
        // Sparse symptom-only entry — exactly what the rule engine needs to
        // fire TIER_1_ANGIOEDEMA without any BP value.
        medication_taken: false,
        face_swelling: true,
        throat_tightness: true,
        symptoms: [],
      },
      { userId: 'voice-user-1', timezone: 'America/New_York' },
    )
    expect(dailyJournal.create).toHaveBeenCalledTimes(1)
    const dto = (dailyJournal.create as jest.Mock).mock.calls[0][1] as Record<string, unknown>
    expect(dto.faceSwelling).toBe(true)
    expect(dto.throatTightness).toBe(true)
  })

  it('GAP — voice submit_checkin is STILL MISSING Cluster 7 (BB/ACE side-effect) symptoms', async () => {
    // Cluster 7 (fatigue, shortnessOfBreath, dryCough, nsaidUse) is
    // pending Manisha sign-off — clinical workflow decision whether voice
    // during-check-in should accept them or route through a future
    // log_symptom_quick voice analog. Tracking the gap until resolved.
    const moduleRef = await Test.createTestingModule({
      providers: [
        VoiceToolsService,
        { provide: DailyJournalService, useValue: {} },
        { provide: GeminiService, useValue: {} },
        { provide: AlertEngineService, useValue: {} },
        { provide: IntakeStatusService, useValue: { getStatus: async () => ({ completed: true, profileExists: true }) } },
        { provide: PrismaService, useValue: { emergencyEvent: { create: async () => ({}) } } },
        { provide: EventEmitter2, useValue: { emit: () => {} } },
      ],
    }).compile()
    const svc = moduleRef.get(VoiceToolsService)
    const submit = svc.getToolDeclarations().find(
      (d) => d.name === 'submit_checkin',
    )
    const props = (submit!.parameters!.properties ?? {}) as Record<string, unknown>

    const CLUSTER_7 = ['fatigue', 'shortness_of_breath', 'dry_cough', 'nsaid_use']
    const missingC7 = CLUSTER_7.filter((k) => !(k in props))
    expect(missingC7.sort()).toEqual(CLUSTER_7.sort())
  })
})

// ─── 3. Tool descriptions stay in sync with the engine semantics ─────────────

describe('Tool description sanity', () => {
  it('flag_emergency description mentions present-tense gating', () => {
    const decl = getJournalToolDeclarations().find(
      (d) => d.name === 'flag_emergency',
    )
    expect(decl).toBeDefined()
    expect(decl!.description?.toLowerCase()).toContain('right now')
  })

  it('log_symptom_quick description names all 19 symptom keys it can fire', () => {
    const decl = getJournalToolDeclarations().find(
      (d) => d.name === 'log_symptom_quick',
    )
    expect(decl).toBeDefined()
    const symptomEnumDoc =
      (
        (decl!.parameters?.properties as Record<string, { description?: string }>)
          ?.symptom?.description ?? ''
      ).toLowerCase()
    for (const key of ALL_STRUCTURED_SYMPTOM_KEYS) {
      expect(symptomEnumDoc).toContain(key.toLowerCase())
    }
  })

  it('submit_bp_from_photo description requires verbal confirmation before save', () => {
    const decl = getJournalToolDeclarations().find(
      (d) => d.name === 'submit_bp_from_photo',
    )
    expect(decl).toBeDefined()
    const desc = (decl!.description ?? '').toLowerCase()
    expect(desc).toMatch(/(confirm|confirms)/)
    expect(desc).toContain('submit_checkin')
  })

  it('log_medication_adherence enumerates the three valid statuses', () => {
    const decl = getJournalToolDeclarations().find(
      (d) => d.name === 'log_medication_adherence',
    )
    const statusDoc =
      (
        (decl!.parameters?.properties as Record<string, { description?: string }>)
          ?.status?.description ?? ''
      ).toLowerCase()
    expect(statusDoc).toContain('taken')
    expect(statusDoc).toContain('missed')
    expect(statusDoc).toContain('scheduled_later')
  })
})

// ─── 4. executeJournalTool routes every declared tool ─────────────────────────

describe('executeJournalTool routing', () => {
  // All eight tools should have a switch case. We assert each one returns
  // SOMETHING parseable (not the unknown-tool sentinel) when called with
  // empty args — even if the result is an error, the dispatcher matched
  // the name.
  const stubServices = {
    journalService: {
      create: jest.fn().mockResolvedValue({ data: { id: 'x' } } as never),
      findAll: jest.fn().mockResolvedValue({ data: [] } as never),
      update: jest.fn().mockResolvedValue({ data: {} } as never),
      delete: jest.fn().mockResolvedValue(undefined as never),
    },
    adherenceService: {
      log: jest.fn().mockResolvedValue({ logged: true } as never),
    },
    symptomService: {
      log: jest.fn().mockResolvedValue({ logged: true } as never),
    },
    ocrService: {
      extractBp: jest.fn().mockResolvedValue({
        sbp: 120,
        dbp: 80,
        pulse: 72,
        confidence: 0.9,
      } as never),
    },
    alertEngine: {
      evaluateAdHoc: jest.fn().mockResolvedValue({
        evaluated: true,
        ruleId: null,
        tier: null,
        mode: null,
        preDay3: false,
        patientMessage: null,
      } as never),
    },
  }

  for (const name of TEXT_TOOLS_EXPECTED) {
    it(`routes "${name}" without returning the unknown-tool sentinel`, async () => {
      const result = await executeJournalTool(
        name,
        // Provide minimal args so each tool's executor reaches its happy
        // or sad path rather than throwing before the switch returns.
        argsFor(name),
        stubServices as any,
        'user-1',
      )
      const parsed = JSON.parse(result)
      expect(parsed.error).not.toBe(`Unknown tool: ${name}`)
    })
  }

  it('routes an unknown name to the sentinel', async () => {
    const result = await executeJournalTool(
      'totally_not_a_tool',
      {},
      stubServices as any,
      'user-1',
    )
    expect(JSON.parse(result).error).toBe('Unknown tool: totally_not_a_tool')
  })
})

function argsFor(name: string): Record<string, any> {
  switch (name) {
    case 'submit_checkin':
      return {
        entry_date: '2026-05-20',
        measurement_time: '08:30',
        systolic_bp: 120,
        diastolic_bp: 80,
        medication_taken: true,
        symptoms: [],
      }
    case 'get_recent_readings':
      return { days: 7 }
    case 'update_checkin':
      return { entry_date: '2026-05-20', original_time: '08:30', systolic_bp: 125 }
    case 'delete_checkin':
      return { entry_date: '2026-05-20', original_time: '08:30' }
    case 'log_medication_adherence':
      return { status: 'taken', drug_name: 'Lisinopril' }
    case 'log_symptom_quick':
      return { symptom: 'severeHeadache' }
    case 'submit_bp_from_photo':
      return { image_base64: Buffer.from('test').toString('base64'), mime_type: 'image/jpeg' }
    case 'flag_emergency':
      return { emergency_situation: 'chest pain now' }
    case 'evaluate_reading':
      return { systolic_bp: 140, diastolic_bp: 90 }
    default:
      return {}
  }
}
