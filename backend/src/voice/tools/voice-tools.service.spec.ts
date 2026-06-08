// Voice tools dispatch tests. Each tool case mocks the dependent service so
// we can assert: (1) the dispatcher routes by name to the right method, (2)
// arguments are coerced + threaded through correctly, (3) the side-channel
// `events` array surfaces the right Socket.io fan-out shape, (4) the
// llmResponse matches Gemini's FunctionResponse contract.

import { jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { VoiceToolsService, mapVoiceSymptomsToFlags } from './voice-tools.service.js'
import { DailyJournalService } from '../../daily_journal/daily_journal.service.js'
import { AlertEngineService } from '../../daily_journal/services/alert-engine.service.js'
import { GeminiService } from '../../gemini/gemini.service.js'
import { IntakeStatusService } from '../../intake/intake-status.service.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { EMERGENCY_EVENTS } from '../../chat/emergency-events.js'

const CTX = { userId: 'user-1', timezone: 'America/New_York' }

describe('VoiceToolsService.dispatch', () => {
  let service: VoiceToolsService
  let dailyJournal: { create: jest.Mock; findAll: jest.Mock; findOne: jest.Mock; update: jest.Mock; delete: jest.Mock }
  let gemini: { extractBpFromImage: jest.Mock }
  let alertEngine: { evaluateAdHoc: jest.Mock }
  let intakeStatus: { getStatus: jest.Mock }
  let prisma: { emergencyEvent: { create: jest.Mock } }
  let eventEmitter: { emit: jest.Mock }

  beforeEach(async () => {
    dailyJournal = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    }
    gemini = { extractBpFromImage: jest.fn() }
    alertEngine = { evaluateAdHoc: jest.fn() }
    intakeStatus = {
      getStatus: jest.fn(async () => ({ completed: true, profileExists: true })) as jest.Mock,
    }
    prisma = { emergencyEvent: { create: jest.fn() as jest.Mock } }
    eventEmitter = { emit: jest.fn() as jest.Mock }

    const moduleRef = await Test.createTestingModule({
      providers: [
        VoiceToolsService,
        { provide: DailyJournalService, useValue: dailyJournal },
        { provide: GeminiService, useValue: gemini },
        { provide: AlertEngineService, useValue: alertEngine },
        { provide: IntakeStatusService, useValue: intakeStatus },
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile()

    service = moduleRef.get(VoiceToolsService)
  })

  // ── declarations ──────────────────────────────────────────────────────────

  it('exposes 9 function declarations (8 prior + flag_emergency)', () => {
    const decls = service.getToolDeclarations()
    const names = decls.map((d) => d.name).sort()
    expect(names).toEqual([
      'check_intake_status',
      'delete_checkin',
      'evaluate_reading',
      'finalize_checkin',
      'flag_emergency',
      'get_recent_readings',
      'submit_bp_from_photo',
      'submit_checkin',
      'update_checkin',
    ])
  })

  // ── Bug 12 regression — flag_emergency on voice ──────────────────────────
  // Voice used to have no emergency surface at all; patients saying "I'm
  // having a stroke" got verbal "call 911" but no audit row and no care-team
  // page. The new tool persists EmergencyEvent + emits EMERGENCY_EVENTS.FLAGGED
  // so EscalationService can dispatch caregivers / provider notifications.

  it('flag_emergency: persists EmergencyEvent + emits EMERGENCY_EVENTS.FLAGGED + returns flagged:true', async () => {
    ;(prisma.emergencyEvent.create as jest.Mock<any>).mockResolvedValue({} as never)
    const r = await service.dispatch(
      'flag_emergency',
      { emergency_situation: 'patient says they cannot breathe' },
      CTX,
    )
    expect(r.llmResponse).toEqual(
      expect.objectContaining({
        flagged: true,
        emergency_situation: 'patient says they cannot breathe',
      }),
    )
    expect(prisma.emergencyEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          isEmergency: true,
          emergency_situation: 'patient says they cannot breathe',
        }),
      }),
    )
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      EMERGENCY_EVENTS.FLAGGED,
      expect.objectContaining({
        userId: 'user-1',
        situation: 'patient says they cannot breathe',
        source: 'voice-tool',
      }),
    )
  })

  it('flag_emergency: still returns flagged:true (and 911 guidance) even when DB write fails', async () => {
    ;(prisma.emergencyEvent.create as jest.Mock<any>).mockRejectedValue(new Error('DB down'))
    const r = await service.dispatch(
      'flag_emergency',
      { emergency_situation: 'chest pain right now' },
      CTX,
    )
    // The patient's verbal "call 911" path must NEVER be blocked by an
    // audit-write failure — that's the whole point of the [SECURITY-CRITICAL]
    // log in the catch block.
    expect(r.llmResponse).toEqual(expect.objectContaining({ flagged: true }))
    // The event is NOT emitted when the persistence failed (we only emit on
    // successful row insert so EscalationService doesn't dispatch for a row
    // it can't audit-link to later).
    expect(eventEmitter.emit).not.toHaveBeenCalled()
  })

  // Regression guard for the natural-language delete/update UX fix. Mirrors
  // the same guard in chat/tools/journal-tools.spec.ts. Without this,
  // someone could trim the voice tool descriptions and the bot would go back
  // to asking the patient for date+time on "delete the last reading".
  it('delete_checkin description spells out natural-language target resolution', () => {
    const decls = service.getToolDeclarations()
    const del = decls.find((d) => d.name === 'delete_checkin')
    expect(del).toBeDefined()
    const desc = (del?.description ?? '').toLowerCase()
    expect(desc).toContain('get_recent_readings')
    expect(desc).toContain('last reading')
    expect(desc).toMatch(/do not ask.*date/i)
  })

  it('update_checkin description spells out natural-language target resolution', () => {
    const decls = service.getToolDeclarations()
    const update = decls.find((d) => d.name === 'update_checkin')
    expect(update).toBeDefined()
    const desc = (update?.description ?? '').toLowerCase()
    expect(desc).toContain('get_recent_readings')
    expect(desc).toContain('last reading')
    expect(desc).toMatch(/do not ask.*date/i)
  })

  // Bug 21c — voice get_recent_readings description was narrow ("Use for
  // history questions"). LLM didn't reliably route phrases like "give me
  // my readings" / "show me my BP" / "my history" to this tool. Now the
  // description enumerates common patient phrasings so the LLM has concrete
  // examples to match against.
  it('get_recent_readings description lists patient phrasings (Bug 21c)', () => {
    const decls = service.getToolDeclarations()
    const get = decls.find((d) => d.name === 'get_recent_readings')
    expect(get).toBeDefined()
    const desc = (get?.description ?? '').toLowerCase()
    expect(desc).toContain('give me my readings')
    expect(desc).toContain('show me my')
    expect(desc).toMatch(/my history|my check-ins|my measurements/)
  })

  it('returns ok:false for an unknown tool name', async () => {
    const r = await service.dispatch('not_a_tool', {}, CTX)
    expect(r.llmResponse).toEqual(expect.objectContaining({ ok: false }))
    expect(r.events).toEqual([])
  })

  // ── submit_checkin ────────────────────────────────────────────────────────

  it('submit_checkin: calls dailyJournal.create with mapped DTO and emits checkin_saved', async () => {
    ;(dailyJournal.create as jest.Mock<any>).mockResolvedValue({})
    const r = await service.dispatch(
      'submit_checkin',
      {
        systolic_bp: 130,
        diastolic_bp: 80,
        medication_taken: true,
        weight: 165,
        symptoms: ['headache'],
        entry_date: '',
        measurement_time: 'now',
        pulse: 72,
        position: 'sitting',
        severe_headache: true,
      },
      CTX,
    )

    expect(dailyJournal.create).toHaveBeenCalledTimes(1)
    const [calledUserId, dto] = (dailyJournal.create as jest.Mock).mock.calls[0]
    expect(calledUserId).toBe('user-1')
    expect(dto).toEqual(expect.objectContaining({
      systolicBP: 130,
      diastolicBP: 80,
      medicationTaken: true,
      // Bug 19 — args.weight is lbs (per tool description + voice prompt);
      // DTO must be kg. 165 × 0.45359237 = 74.84 → rounded = 74.8 kg.
      weight: 74.8,
      pulse: 72,
      position: 'SITTING',
      severeHeadache: true,
      symptoms: ['headache'],
    }))

    expect(r.llmResponse).toEqual(expect.objectContaining({ saved: true }))
    const kinds = r.events.map((e) => e.kind)
    expect(kinds).toEqual(['action', 'checkin_saved', 'action_complete'])
  })

  it('submit_checkin: rejects out-of-range BP without calling the service', async () => {
    const r = await service.dispatch(
      'submit_checkin',
      { systolic_bp: 999, diastolic_bp: 80, medication_taken: false },
      CTX,
    )
    expect(dailyJournal.create).not.toHaveBeenCalled()
    expect(r.llmResponse).toEqual(expect.objectContaining({ saved: false }))
    expect((r.llmResponse as any).message).toMatch(/out of range/i)
  })

  it('submit_checkin: sparse log (BP=0/0) does NOT send systolicBP/diastolicBP fields', async () => {
    ;(dailyJournal.create as jest.Mock<any>).mockResolvedValue({})
    await service.dispatch(
      'submit_checkin',
      { systolic_bp: 0, diastolic_bp: 0, medication_taken: true, severe_headache: true },
      CTX,
    )
    const [, dto] = (dailyJournal.create as jest.Mock).mock.calls[0] as [string, Record<string, unknown>]
    expect('systolicBP' in dto).toBe(false)
    expect('diastolicBP' in dto).toBe(false)
    expect(dto.severeHeadache).toBe(true)
  })

  it('submit_checkin: returns saved=false + does NOT emit checkin_saved on service failure (still emits action_complete)', async () => {
    ;(dailyJournal.create as jest.Mock<any>).mockRejectedValue(new Error('DB down'))
    const r = await service.dispatch(
      'submit_checkin',
      { systolic_bp: 130, diastolic_bp: 80, medication_taken: true },
      CTX,
    )
    expect(r.llmResponse).toEqual(expect.objectContaining({ saved: false }))
    const checkinSaved = r.events.find((e) => e.kind === 'checkin_saved')
    expect(checkinSaved).toBeDefined()
    expect((checkinSaved as any).payload.saved).toBe(false)
    const ac = r.events.find((e) => e.kind === 'action_complete') as any
    expect(ac.success).toBe(false)
  })

  // Bug 5 regression — without the guard, an LLM call without medication_taken
  // would silently flag the patient as non-adherent (toBool default false).
  // Stage-B medication-adherence alerts (Tier 2/3) would fire on a patient who
  // actually took their meds — the bot just never asked.
  it('submit_checkin: rejects with MISSING_FIELD when medication_taken is omitted', async () => {
    const r = await service.dispatch(
      'submit_checkin',
      { systolic_bp: 130, diastolic_bp: 80 }, // medication_taken intentionally absent
      CTX,
    )
    expect(r.llmResponse).toEqual(
      expect.objectContaining({
        saved: false,
        reason: 'MISSING_FIELD',
      }),
    )
    expect((r.llmResponse as any).message).toMatch(/medication/i)
    expect(dailyJournal.create).not.toHaveBeenCalled()
  })

  it('submit_checkin: rejects with MISSING_FIELD when medication_taken is null', async () => {
    const r = await service.dispatch(
      'submit_checkin',
      { systolic_bp: 130, diastolic_bp: 80, medication_taken: null },
      CTX,
    )
    expect(r.llmResponse).toEqual(
      expect.objectContaining({ saved: false, reason: 'MISSING_FIELD' }),
    )
    expect(dailyJournal.create).not.toHaveBeenCalled()
  })

  // ── get_recent_readings ───────────────────────────────────────────────────

  it('get_recent_readings: clamps days to [1,30] and returns line summary', async () => {
    ;(dailyJournal.findAll as jest.Mock<any>).mockResolvedValue({
      data: [
        {
          id: 'e1',
          measuredAt: '2026-04-22T10:00:00Z',
          systolicBP: 130,
          diastolicBP: 80,
          medicationTaken: true,
          otherSymptoms: ['headache'],
        },
      ],
    })
    const r = await service.dispatch('get_recent_readings', { days: 999 }, CTX)
    expect(dailyJournal.findAll).toHaveBeenCalledWith(
      'user-1',
      expect.any(String),
      expect.any(String),
      5,
    )
    expect(r.llmResponse).toEqual(expect.objectContaining({ count: 1 }))
    expect((r.llmResponse as any).summary).toMatch(/entry_id="e1"/)
    expect((r.llmResponse as any).summary).toMatch(/BP 130\/80/)
  })

  it('get_recent_readings: empty list returns "No readings found."', async () => {
    ;(dailyJournal.findAll as jest.Mock<any>).mockResolvedValue({ data: [] })
    const r = await service.dispatch('get_recent_readings', {}, CTX)
    expect((r.llmResponse as any).summary).toBe('No readings found.')
    expect((r.llmResponse as any).count).toBe(0)
  })

  // ─── Bug 19 — weight lbs→kg conversion at voice dispatcher ────────────
  // Voice tool description + voice prompt both tell the LLM to pass
  // weight in lbs. JournalEntry.weight stores kg. submitCheckin /
  // updateCheckin both must convert before writing — pre-fix they
  // persisted the lbs value as kg, then formatWeightLbs() re-multiplied
  // for display (150 lbs → 330.7 lbs in My Readings).

  it('submit_checkin: omits weight when args.weight is 0 (skipped)', async () => {
    ;(dailyJournal.create as jest.Mock<any>).mockResolvedValue({})
    await service.dispatch(
      'submit_checkin',
      {
        systolic_bp: 120,
        diastolic_bp: 80,
        medication_taken: true,
        weight: 0,
        symptoms: [],
      },
      CTX,
    )
    const dto = (dailyJournal.create as jest.Mock).mock.calls[0][1] as { weight?: number }
    // 0-weight (skip sentinel from voice) must not land as 0 kg.
    expect(dto.weight).toBeUndefined()
  })

  // ─── kg/lbs follow-up — weight_unit handling on voice ─────────────────
  it('submit_checkin: weight_unit="KG" persists raw (no conversion)', async () => {
    ;(dailyJournal.create as jest.Mock<any>).mockResolvedValue({})
    await service.dispatch(
      'submit_checkin',
      {
        systolic_bp: 120,
        diastolic_bp: 80,
        medication_taken: true,
        weight: 68,
        weight_unit: 'KG',
        symptoms: [],
      },
      CTX,
    )
    const dto = (dailyJournal.create as jest.Mock).mock.calls[0][1] as { weight: number }
    expect(dto.weight).toBe(68.0)
  })

  it('submit_checkin: weight_unit="LBS" converts to kg', async () => {
    ;(dailyJournal.create as jest.Mock<any>).mockResolvedValue({})
    await service.dispatch(
      'submit_checkin',
      {
        systolic_bp: 120,
        diastolic_bp: 80,
        medication_taken: true,
        weight: 150,
        weight_unit: 'LBS',
        symptoms: [],
      },
      CTX,
    )
    const dto = (dailyJournal.create as jest.Mock).mock.calls[0][1] as { weight: number }
    expect(dto.weight).toBe(68.0)
  })

  it('update_checkin: weight_unit="KG" persists raw on update', async () => {
    ;(dailyJournal.update as jest.Mock<any>).mockResolvedValue({})
    await service.dispatch(
      'update_checkin',
      { entry_id: 'entry-1', weight: 90, weight_unit: 'KG' },
      CTX,
    )
    const dto = (dailyJournal.update as jest.Mock).mock.calls[0][2] as { weight: number }
    expect(dto.weight).toBe(90.0)
  })

  it('update_checkin: applies same lbs→kg conversion when weight is updated', async () => {
    ;(dailyJournal.update as jest.Mock<any>).mockResolvedValue({})
    await service.dispatch(
      'update_checkin',
      { entry_id: 'entry-1', weight: 200 },
      CTX,
    )
    expect(dailyJournal.update).toHaveBeenCalledTimes(1)
    const dto = (dailyJournal.update as jest.Mock).mock.calls[0][2] as { weight: number }
    // 200 × 0.45359237 = 90.71874 → 90.7 kg
    expect(dto.weight).toBe(90.7)
  })

  // ── update_checkin ────────────────────────────────────────────────────────

  it('update_checkin: returns updated:false when only entry_id is given (no fields)', async () => {
    const r = await service.dispatch('update_checkin', { entry_id: 'abc' }, CTX)
    expect(dailyJournal.update).not.toHaveBeenCalled()
    expect(r.llmResponse).toEqual({ updated: false, message: 'No fields to update.' })
  })

  // Bug 6 regression — when patient asks to change the time and `findOne`
  // throws (entry deleted, id hallucinated), do NOT silently apply OTHER
  // field changes while dropping the requested time. Reject the whole update
  // so the LLM tells the patient honestly instead of claiming success.
  it('update_checkin: rejects with updated:false when measurement_time is given but findOne throws', async () => {
    ;(dailyJournal.findOne as jest.Mock<any>).mockRejectedValue(new Error('Entry not found'))
    const r = await service.dispatch(
      'update_checkin',
      { entry_id: 'stale-id', measurement_time: '09:00', systolic_bp: 140 },
      CTX,
    )
    expect(r.llmResponse).toEqual(
      expect.objectContaining({ updated: false }),
    )
    expect((r.llmResponse as any).message).toMatch(/get_recent_readings/i)
    expect(dailyJournal.update).not.toHaveBeenCalled()
  })

  it('update_checkin: rejects with updated:false when findOne returns no measuredAt', async () => {
    ;(dailyJournal.findOne as jest.Mock<any>).mockResolvedValue({ data: { measuredAt: null } })
    const r = await service.dispatch(
      'update_checkin',
      { entry_id: 'weird-id', measurement_time: '09:00', systolic_bp: 140 },
      CTX,
    )
    expect(r.llmResponse).toEqual(
      expect.objectContaining({ updated: false }),
    )
    expect(dailyJournal.update).not.toHaveBeenCalled()
  })

  it('update_checkin: maps medication_taken="yes" → true and calls update', async () => {
    ;(dailyJournal.update as jest.Mock<any>).mockResolvedValue({
      data: {
        measuredAt: '2026-04-22T10:00:00Z',
        systolicBP: 135,
        diastolicBP: 85,
        medicationTaken: true,
        otherSymptoms: [],
      },
    })
    const r = await service.dispatch(
      'update_checkin',
      { entry_id: 'abc', systolic_bp: 135, diastolic_bp: 85, medication_taken: 'yes' },
      CTX,
    )
    expect(dailyJournal.update).toHaveBeenCalledWith(
      'user-1',
      'abc',
      expect.objectContaining({ systolicBP: 135, diastolicBP: 85, medicationTaken: true }),
    )
    expect(r.llmResponse).toEqual(expect.objectContaining({ updated: true }))
    const cu = r.events.find((e) => e.kind === 'checkin_updated') as any
    expect(cu.payload.entryId).toBe('abc')
  })

  // ── delete_checkin ────────────────────────────────────────────────────────

  it('delete_checkin: parses comma-separated ids and calls delete per id', async () => {
    ;(dailyJournal.delete as jest.Mock<any>).mockResolvedValue({})
    const r = await service.dispatch(
      'delete_checkin',
      { entry_ids: 'a, b, c' },
      CTX,
    )
    expect(dailyJournal.delete).toHaveBeenCalledTimes(3)
    expect((dailyJournal.delete as jest.Mock).mock.calls.map((c) => c[1])).toEqual(['a', 'b', 'c'])
    expect(r.llmResponse).toEqual(expect.objectContaining({ deleted_count: 3, failed_count: 0 }))
  })

  it('delete_checkin: counts failed_count when service rejects some', async () => {
    ;(dailyJournal.delete as jest.Mock).mockImplementation((_uid: unknown, id: unknown) => {
      if (id === 'b') return Promise.reject(new Error('boom'))
      return Promise.resolve({})
    })
    const r = await service.dispatch('delete_checkin', { entry_ids: 'a,b,c' }, CTX)
    expect(r.llmResponse).toEqual(expect.objectContaining({ deleted_count: 2, failed_count: 1 }))
  })

  it('delete_checkin: empty input returns 0/0 count', async () => {
    const r = await service.dispatch('delete_checkin', { entry_ids: '' }, CTX)
    expect(dailyJournal.delete).not.toHaveBeenCalled()
    expect(r.llmResponse).toEqual({
      deleted_count: 0,
      failed_count: 0,
      message: 'No entry IDs provided.',
    })
  })

  // ── submit_bp_from_photo ──────────────────────────────────────────────────

  it('submit_bp_from_photo: returns parsed=true on a valid OCR result', async () => {
    ;(gemini.extractBpFromImage as jest.Mock<any>).mockResolvedValue({
      sbp: 130,
      dbp: 80,
      pulse: 72,
      confidence: 0.9,
      raw: '{}',
    })
    const r = await service.dispatch(
      'submit_bp_from_photo',
      { image_base64: 'ZmFrZQ==', mime_type: 'image/jpeg' },
      CTX,
    )
    expect(r.llmResponse).toEqual(expect.objectContaining({
      parsed: true,
      sbp: 130,
      dbp: 80,
      pulse: 72,
      confidence: 0.9,
    }))
  })

  it('submit_bp_from_photo: missing image returns parsed=false without calling Gemini', async () => {
    const r = await service.dispatch(
      'submit_bp_from_photo',
      { image_base64: '', mime_type: '' },
      CTX,
    )
    expect(gemini.extractBpFromImage).not.toHaveBeenCalled()
    expect(r.llmResponse).toEqual(expect.objectContaining({ parsed: false }))
  })

  it('submit_bp_from_photo: low-confidence returns parsed=false with LOW_CONFIDENCE code', async () => {
    ;(gemini.extractBpFromImage as jest.Mock<any>).mockResolvedValue({
      sbp: null,
      dbp: null,
      pulse: null,
      confidence: 0,
      raw: '',
    })
    const r = await service.dispatch(
      'submit_bp_from_photo',
      { image_base64: 'ZmFrZQ==', mime_type: 'image/jpeg' },
      CTX,
    )
    expect(r.llmResponse).toEqual(expect.objectContaining({
      parsed: false,
      code: 'LOW_CONFIDENCE',
    }))
  })

  // ── evaluate_reading ──────────────────────────────────────────────────────
  // Voice mirror of the text-chat tool: ask the rule engine what a reading
  // means for THIS patient without persisting anything. The engine itself is
  // mocked — see alert-engine.evaluate-ad-hoc.spec.ts for engine behaviour.

  describe('evaluate_reading', () => {
    it('calls evaluateAdHoc with mapped sbp/dbp/pulse and returns the engine result via llmResponse', async () => {
      ;(alertEngine.evaluateAdHoc as jest.Mock<any>).mockResolvedValue({
        evaluated: true,
        ruleId: 'RULE_PERSONALIZED_HIGH',
        tier: 'BP_LEVEL_1_HIGH',
        mode: 'PERSONALIZED',
        preDay3: false,
        patientMessage: 'Your 140/90 is above the SBP goal of 130 your provider set.',
      })
      const r = await service.dispatch(
        'evaluate_reading',
        { systolic_bp: 140, diastolic_bp: 90, heart_rate: 78 },
        CTX,
      )
      expect(alertEngine.evaluateAdHoc).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          systolicBP: 140,
          diastolicBP: 90,
          pulse: 78,
        }),
      )
      expect(r.llmResponse).toEqual(
        expect.objectContaining({
          evaluated: true,
          ruleId: 'RULE_PERSONALIZED_HIGH',
          patientMessage: expect.stringMatching(/above the SBP goal/),
        }),
      )
      // Voice-only: evaluate_reading must NOT trigger a Socket.io side-channel
      // event. It is read-only — nothing to fan out to the UI.
      expect(r.events).toEqual([])
    })

    it('omits pulse (pulse=null) when heart_rate is absent or 0', async () => {
      ;(alertEngine.evaluateAdHoc as jest.Mock<any>).mockResolvedValue({
        evaluated: true,
        ruleId: null,
        tier: null,
        mode: null,
        preDay3: false,
        patientMessage: null,
      })
      await service.dispatch(
        'evaluate_reading',
        { systolic_bp: 122, diastolic_bp: 76 },
        CTX,
      )
      expect(alertEngine.evaluateAdHoc).toHaveBeenCalledWith(
        expect.objectContaining({ pulse: null }),
      )
    })

    it('rejects zero or missing sbp/dbp without calling the engine', async () => {
      const r = await service.dispatch(
        'evaluate_reading',
        { systolic_bp: 0, diastolic_bp: 0 },
        CTX,
      )
      expect(alertEngine.evaluateAdHoc).not.toHaveBeenCalled()
      expect(r.llmResponse).toEqual(
        expect.objectContaining({
          evaluated: false,
          message: expect.stringMatching(/positive numbers/i),
        }),
      )
    })

    it('returns a graceful failure when the engine throws — voice never crashes mid-turn', async () => {
      ;(alertEngine.evaluateAdHoc as jest.Mock<any>).mockRejectedValue(new Error('engine down'))
      const r = await service.dispatch(
        'evaluate_reading',
        { systolic_bp: 140, diastolic_bp: 90 },
        CTX,
      )
      // The evaluateReading() handler catches its own errors and returns a
      // typed `{evaluated:false, message}` envelope so the LLM can degrade
      // gracefully — the outer dispatch catch only fires for unhandled throws.
      expect(r.llmResponse).toEqual(
        expect.objectContaining({
          evaluated: false,
          message: expect.stringMatching(/evaluation failed/i),
        }),
      )
      expect(r.events).toEqual([])
    })

    it('surfaces PROFILE_NOT_FOUND from the engine into llmResponse so the LLM can degrade gracefully', async () => {
      ;(alertEngine.evaluateAdHoc as jest.Mock<any>).mockResolvedValue({
        evaluated: false,
        reason: 'PROFILE_NOT_FOUND',
      })
      const r = await service.dispatch(
        'evaluate_reading',
        { systolic_bp: 140, diastolic_bp: 90 },
        CTX,
      )
      expect(r.llmResponse).toEqual({
        evaluated: false,
        reason: 'PROFILE_NOT_FOUND',
      })
    })

    it('maps natural-language symptom phrases onto structured engine flags', async () => {
      ;(alertEngine.evaluateAdHoc as jest.Mock<any>).mockResolvedValue({
        evaluated: true,
        ruleId: 'RULE_SYMPTOM_OVERRIDE_GENERAL',
        tier: 'BP_LEVEL_2',
        mode: 'STANDARD',
        preDay3: false,
        patientMessage: 'Call 911 — chest pressure with elevated BP.',
      })
      await service.dispatch(
        'evaluate_reading',
        {
          systolic_bp: 150,
          diastolic_bp: 95,
          symptoms: ['chest pain', 'dizzy', 'palpitations'],
        },
        CTX,
      )
      const call = (alertEngine.evaluateAdHoc as jest.Mock).mock.calls[0][0] as Record<string, any>
      expect(call.symptoms).toEqual(
        expect.objectContaining({
          chestPainOrDyspnea: true,
          dizziness: true,
          palpitations: true,
        }),
      )
    })
  })
})

// ─── Bug 2 + 3 regression guards for the voice symptom mapper ───────────────
// Mirrors the text-side guards in chat/tools/journal-tools.spec.ts. Both
// mappers must stay in lockstep or the LLM gets surface-dependent behaviour.
describe('mapVoiceSymptomsToFlags', () => {
  it('flips structured booleans on positive freeform phrases', () => {
    expect(mapVoiceSymptomsToFlags(['chest pain'])).toEqual({
      chestPainOrDyspnea: true,
    })
    expect(mapVoiceSymptomsToFlags(['dizzy', 'palpitations'])).toEqual({
      dizziness: true,
      palpitations: true,
    })
  })

  it('Bug 2 regression — does NOT flip flags on negation phrases', () => {
    expect(mapVoiceSymptomsToFlags(['no chest pain'])).toBeUndefined()
    expect(mapVoiceSymptomsToFlags(['denies dizziness'])).toBeUndefined()
    expect(mapVoiceSymptomsToFlags(['without headache'])).toBeUndefined()
    expect(mapVoiceSymptomsToFlags(['none'])).toBeUndefined()
    expect(mapVoiceSymptomsToFlags(['negative for chest pain'])).toBeUndefined()
  })

  it('Bug 2 regression — mixed negated + positive list keeps only the positives', () => {
    expect(
      mapVoiceSymptomsToFlags(['no chest pain', 'dizzy', 'denies headache']),
    ).toEqual({ dizziness: true })
  })

  it('Bug 3 regression — face_swelling underscore variant flips faceSwelling', () => {
    expect(mapVoiceSymptomsToFlags(['face_swelling'])).toEqual({
      faceSwelling: true,
    })
  })

  it('Bug 3 regression — all snake_case schema keys round-trip', () => {
    expect(mapVoiceSymptomsToFlags(['severe_headache'])).toEqual({ severeHeadache: true })
    expect(mapVoiceSymptomsToFlags(['chest_pain_or_dyspnea'])).toEqual({ chestPainOrDyspnea: true })
    expect(mapVoiceSymptomsToFlags(['altered_mental_status'])).toEqual({ alteredMentalStatus: true })
    expect(mapVoiceSymptomsToFlags(['throat_tightness'])).toEqual({ throatTightness: true })
  })
})
