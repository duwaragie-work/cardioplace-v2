// Voice tools dispatch tests. Each tool case mocks the dependent service so
// we can assert: (1) the dispatcher routes by name to the right method, (2)
// arguments are coerced + threaded through correctly, (3) the side-channel
// `events` array surfaces the right Socket.io fan-out shape, (4) the
// llmResponse matches Gemini's FunctionResponse contract.

import { jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import { VoiceToolsService } from './voice-tools.service.js'
import { DailyJournalService } from '../../daily_journal/daily_journal.service.js'
import { AlertEngineService } from '../../daily_journal/services/alert-engine.service.js'
import { GeminiService } from '../../gemini/gemini.service.js'
import { IntakeStatusService } from '../../intake/intake-status.service.js'

const CTX = { userId: 'user-1', timezone: 'America/New_York' }

describe('VoiceToolsService.dispatch', () => {
  let service: VoiceToolsService
  let dailyJournal: { create: jest.Mock; findAll: jest.Mock; findOne: jest.Mock; update: jest.Mock; delete: jest.Mock }
  let gemini: { extractBpFromImage: jest.Mock }
  let alertEngine: { evaluateAdHoc: jest.Mock }
  let intakeStatus: { getStatus: jest.Mock }

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

    const moduleRef = await Test.createTestingModule({
      providers: [
        VoiceToolsService,
        { provide: DailyJournalService, useValue: dailyJournal },
        { provide: GeminiService, useValue: gemini },
        { provide: AlertEngineService, useValue: alertEngine },
        { provide: IntakeStatusService, useValue: intakeStatus },
      ],
    }).compile()

    service = moduleRef.get(VoiceToolsService)
  })

  // ── declarations ──────────────────────────────────────────────────────────

  it('exposes 8 function declarations (5 Python-contract + evaluate_reading + finalize_checkin + check_intake_status)', () => {
    const decls = service.getToolDeclarations()
    const names = decls.map((d) => d.name).sort()
    expect(names).toEqual([
      'check_intake_status',
      'delete_checkin',
      'evaluate_reading',
      'finalize_checkin',
      'get_recent_readings',
      'submit_bp_from_photo',
      'submit_checkin',
      'update_checkin',
    ])
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
      weight: 165,
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

  // ── update_checkin ────────────────────────────────────────────────────────

  it('update_checkin: returns updated:false when only entry_id is given (no fields)', async () => {
    const r = await service.dispatch('update_checkin', { entry_id: 'abc' }, CTX)
    expect(dailyJournal.update).not.toHaveBeenCalled()
    expect(r.llmResponse).toEqual({ updated: false, message: 'No fields to update.' })
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
