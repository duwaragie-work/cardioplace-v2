import { jest } from '@jest/globals'
import { getJournalToolDeclarations, executeJournalTool, normaliseTime } from './journal-tools.js'

describe('journal-tools', () => {
  describe('normaliseTime', () => {
    it('should return HH:mm for already valid 24h format', () => {
      expect(normaliseTime('08:30')).toBe('08:30')
      expect(normaliseTime('14:15')).toBe('14:15')
      expect(normaliseTime('23:59')).toBe('23:59')
    })

    it('should convert AM/PM with minutes', () => {
      expect(normaliseTime('1:00 PM')).toBe('13:00')
      expect(normaliseTime('8:30 am')).toBe('08:30')
      expect(normaliseTime('12:00 PM')).toBe('12:00')
      expect(normaliseTime('12:00 AM')).toBe('00:00')
    })

    it('should convert AM/PM without minutes', () => {
      expect(normaliseTime('2 PM')).toBe('14:00')
      expect(normaliseTime('8 am')).toBe('08:00')
    })

    it('should handle bare H:mm format', () => {
      expect(normaliseTime('9:30')).toBe('09:30')
    })

    it('should return undefined for invalid input', () => {
      expect(normaliseTime(undefined)).toBeUndefined()
      expect(normaliseTime('')).toBeUndefined()
      expect(normaliseTime('not a time')).toBeUndefined()
    })
  })

  describe('getJournalToolDeclarations', () => {
    // Updated 2026-05 — catalog grew from 8 to 9 with the addition of
    // evaluate_reading (chatbot can ask the rule engine what a given
    // BP/HR reading means for this patient, returning the canonical
    // patient-tier message).
    it('should return 9 tool declarations', () => {
      const declarations = getJournalToolDeclarations()
      expect(declarations).toHaveLength(9)
      expect(declarations.map((d) => d.name).sort()).toEqual([
        'delete_checkin',
        'evaluate_reading',
        'flag_emergency',
        'get_recent_readings',
        'log_medication_adherence',
        'log_symptom_quick',
        'submit_bp_from_photo',
        'submit_checkin',
        'update_checkin',
      ])
    })

    it('should have required fields on submit_checkin', () => {
      const declarations = getJournalToolDeclarations()
      const submit = declarations.find((d) => d.name === 'submit_checkin')!
      expect(submit.parameters?.required).toContain('systolic_bp')
      expect(submit.parameters?.required).toContain('diastolic_bp')
      expect(submit.parameters?.required).toContain('medication_taken')
    })

    it('should have required fields on update_checkin', () => {
      const declarations = getJournalToolDeclarations()
      const update = declarations.find((d) => d.name === 'update_checkin')!
      expect(update.parameters?.required).toContain('entry_date')
      expect(update.parameters?.required).toContain('original_time')
    })

    it('should have required fields on delete_checkin', () => {
      const declarations = getJournalToolDeclarations()
      const del = declarations.find((d) => d.name === 'delete_checkin')!
      expect(del.parameters?.required).toContain('entry_date')
      expect(del.parameters?.required).toContain('original_time')
    })
  })

  describe('executeJournalTool', () => {
    const mockJournalService = {
      create: jest.fn<any>(),
      findAll: jest.fn<any>(),
      update: jest.fn<any>(),
      delete: jest.fn<any>(),
    }

    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('should execute submit_checkin and return saved result', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: '123', systolicBP: 120, diastolicBP: 80 },
      })

      const result = await executeJournalTool(
        'submit_checkin',
        {
          entry_date: '2026-04-06',
          // Updated 2026-05 (Phase/27) — measurement_time is now a
          // required-field gate ahead of journal.create. Provide it so
          // the happy path reaches the executor.
          measurement_time: '08:30',
          systolic_bp: 120,
          diastolic_bp: 80,
          medication_taken: true,
          symptoms: ['headache'],
        },
        mockJournalService as any,
        'user-1',
      )

      const parsed = JSON.parse(result)
      expect(parsed.saved).toBe(true)
      expect(mockJournalService.create).toHaveBeenCalledWith('user-1', expect.objectContaining({
        systolicBP: 120,
        diastolicBP: 80,
      }))
    })

    it('should reject submit_checkin when missing required fields', async () => {
      const result = await executeJournalTool(
        'submit_checkin',
        { entry_date: '2026-04-06', systolic_bp: 120, diastolic_bp: 80 },
        mockJournalService as any,
        'user-1',
      )

      const parsed = JSON.parse(result)
      expect(parsed.saved).toBe(false)
      expect(parsed._internal).toBe(true)
      // Updated 2026-05 (Phase/27) — measurement_time is now the first
      // required field that hits the missing-field gate after entry_date.
      // The guard returns the FIRST missing field as next_action, so we
      // assert measurement_time. medication_taken would only surface as
      // first-missing if entry_date AND measurement_time were both
      // supplied. See journal-tools.scenarios.spec.ts for the full set.
      expect(parsed.next_action).toContain('Ask about')
      expect(parsed.next_action).toContain('measurement_time')
      expect(mockJournalService.create).not.toHaveBeenCalled()
    })

    it('should execute get_recent_readings', async () => {
      mockJournalService.findAll.mockResolvedValue({
        data: [{ id: '1', measuredAt: '2026-04-05T10:00:00.000Z', systolicBP: 120, diastolicBP: 80 }],
      })

      const result = await executeJournalTool(
        'get_recent_readings',
        { days: 7 },
        mockJournalService as any,
        'user-1',
      )

      const parsed = JSON.parse(result)
      expect(parsed.count).toBe(1)
      expect(parsed.readings).toHaveLength(1)
    })

    it('should execute update_checkin with date/time lookup', async () => {
      mockJournalService.findAll.mockResolvedValue({
        data: [{ id: '123', measuredAt: '2026-04-07T14:30:00.000Z', systolicBP: 120, diastolicBP: 80 }],
      })
      mockJournalService.update.mockResolvedValue({
        data: { id: '123', systolicBP: 125 },
      })

      const result = await executeJournalTool(
        'update_checkin',
        { entry_date: '2026-04-07', original_time: '14:30', systolic_bp: 125 },
        mockJournalService as any,
        'user-1',
      )

      const parsed = JSON.parse(result)
      expect(parsed.updated).toBe(true)
    })

    it('should execute delete_checkin with date/time lookup', async () => {
      mockJournalService.findAll.mockResolvedValue({
        data: [{ id: '123', measuredAt: '2026-04-07T14:30:00.000Z' }],
      })
      mockJournalService.delete.mockResolvedValue(undefined)

      const result = await executeJournalTool(
        'delete_checkin',
        { entry_date: '2026-04-07', original_time: '14:30' },
        mockJournalService as any,
        'user-1',
      )

      const parsed = JSON.parse(result)
      expect(parsed.deleted).toBe(true)
    })

    it('should return error for unknown tool', async () => {
      const result = await executeJournalTool(
        'unknown_tool',
        {},
        mockJournalService as any,
        'user-1',
      )

      const parsed = JSON.parse(result)
      expect(parsed.error).toBe('Unknown tool: unknown_tool')
    })
  })

  // ─── evaluate_reading ──────────────────────────────────────────────────────
  // Wiring + behaviour tests for the chatbot's "what does this reading mean
  // for me?" tool. The engine is mocked — see alert-engine.evaluate-ad-hoc
  // .spec.ts for the engine-side behaviour. These tests cover ONLY the
  // executor: numeric guard, symptom mapper, context plumbing, error paths.

  describe('executeJournalTool — evaluate_reading', () => {
    const mockAlertEngine = {
      evaluateAdHoc: jest.fn<any>(),
    }
    const mockJournalService = {
      create: jest.fn<any>(),
      findAll: jest.fn<any>(),
      update: jest.fn<any>(),
      delete: jest.fn<any>(),
    }
    const ctx = {
      journalService: mockJournalService as any,
      alertEngine: mockAlertEngine as any,
    }

    beforeEach(() => {
      jest.clearAllMocks()
      mockAlertEngine.evaluateAdHoc.mockResolvedValue({
        evaluated: true,
        ruleId: 'RULE_PERSONALIZED_HIGH',
        tier: 'BP_LEVEL_1_HIGH',
        mode: 'PERSONALIZED',
        preDay3: false,
        patientMessage: 'Your 140/90 is above the SBP goal of 130 your provider set.',
      })
    })

    it('calls evaluateAdHoc with the mapped sbp/dbp and returns its JSON verbatim', async () => {
      const result = await executeJournalTool(
        'evaluate_reading',
        { systolic_bp: 140, diastolic_bp: 90, heart_rate: 78 },
        ctx,
        'user-1',
      )
      expect(mockAlertEngine.evaluateAdHoc).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          systolicBP: 140,
          diastolicBP: 90,
          pulse: 78,
        }),
      )
      const parsed = JSON.parse(result)
      expect(parsed.evaluated).toBe(true)
      expect(parsed.ruleId).toBe('RULE_PERSONALIZED_HIGH')
      expect(parsed.patientMessage).toMatch(/above the SBP goal/)
    })

    it('coerces string-numbers from a chatty model into numbers', async () => {
      await executeJournalTool(
        'evaluate_reading',
        { systolic_bp: '145', diastolic_bp: '92', heart_rate: '76' },
        ctx,
        'user-1',
      )
      expect(mockAlertEngine.evaluateAdHoc).toHaveBeenCalledWith(
        expect.objectContaining({ systolicBP: 145, diastolicBP: 92, pulse: 76 }),
      )
    })

    it('omits pulse when heart_rate is absent or non-numeric', async () => {
      await executeJournalTool(
        'evaluate_reading',
        { systolic_bp: 140, diastolic_bp: 90 },
        ctx,
        'user-1',
      )
      expect(mockAlertEngine.evaluateAdHoc).toHaveBeenCalledWith(
        expect.objectContaining({ pulse: null }),
      )
    })

    it('rejects non-numeric sbp/dbp without calling the engine', async () => {
      const result = await executeJournalTool(
        'evaluate_reading',
        { systolic_bp: 'high', diastolic_bp: 'normal' },
        ctx,
        'user-1',
      )
      const parsed = JSON.parse(result)
      expect(parsed.evaluated).toBe(false)
      expect(parsed.message).toMatch(/must be numbers/i)
      expect(mockAlertEngine.evaluateAdHoc).not.toHaveBeenCalled()
    })

    it('returns "tool not available" when alertEngine is missing from context', async () => {
      const ctxNoEngine = { journalService: mockJournalService as any }
      const result = await executeJournalTool(
        'evaluate_reading',
        { systolic_bp: 140, diastolic_bp: 90 },
        ctxNoEngine,
        'user-1',
      )
      const parsed = JSON.parse(result)
      expect(parsed.evaluated).toBe(false)
      expect(parsed.message).toMatch(/not available/i)
    })

    it('surfaces PROFILE_NOT_FOUND from the engine to the LLM as JSON', async () => {
      mockAlertEngine.evaluateAdHoc.mockResolvedValueOnce({
        evaluated: false,
        reason: 'PROFILE_NOT_FOUND',
      })
      const result = await executeJournalTool(
        'evaluate_reading',
        { systolic_bp: 140, diastolic_bp: 90 },
        ctx,
        'user-1',
      )
      const parsed = JSON.parse(result)
      expect(parsed).toEqual({ evaluated: false, reason: 'PROFILE_NOT_FOUND' })
    })

    it('returns a graceful failure when the engine throws', async () => {
      mockAlertEngine.evaluateAdHoc.mockRejectedValueOnce(new Error('engine down'))
      const result = await executeJournalTool(
        'evaluate_reading',
        { systolic_bp: 140, diastolic_bp: 90 },
        ctx,
        'user-1',
      )
      const parsed = JSON.parse(result)
      expect(parsed.evaluated).toBe(false)
      expect(parsed.message).toBe('engine down')
    })

    // ── Symptom mapper ──────────────────────────────────────────────────────

    it('maps natural-language symptoms onto structured flags', async () => {
      await executeJournalTool(
        'evaluate_reading',
        {
          systolic_bp: 145,
          diastolic_bp: 95,
          symptoms: ['chest pain', 'dizzy', 'palpitations', 'severe headache'],
        },
        ctx,
        'user-1',
      )
      const call = mockAlertEngine.evaluateAdHoc.mock.calls[0][0] as Record<string, any>
      expect(call.symptoms).toEqual(
        expect.objectContaining({
          chestPainOrDyspnea: true,
          dizziness: true,
          palpitations: true,
          severeHeadache: true,
        }),
      )
    })

    it('also recognises camelCase structured-symptom keys verbatim', async () => {
      await executeJournalTool(
        'evaluate_reading',
        {
          systolic_bp: 145,
          diastolic_bp: 95,
          symptoms: ['ruqPain', 'faceSwelling', 'throatTightness'],
        },
        ctx,
        'user-1',
      )
      const call = mockAlertEngine.evaluateAdHoc.mock.calls[0][0] as Record<string, any>
      expect(call.symptoms).toEqual(
        expect.objectContaining({
          ruqPain: true,
          faceSwelling: true,
          throatTightness: true,
        }),
      )
    })

    it('passes symptoms=undefined when the array is empty or absent', async () => {
      await executeJournalTool(
        'evaluate_reading',
        { systolic_bp: 145, diastolic_bp: 95, symptoms: [] },
        ctx,
        'user-1',
      )
      const call = mockAlertEngine.evaluateAdHoc.mock.calls[0][0] as Record<string, any>
      expect(call.symptoms).toBeUndefined()
    })

    it('ignores freeform strings the mapper does not recognise', async () => {
      await executeJournalTool(
        'evaluate_reading',
        {
          systolic_bp: 140,
          diastolic_bp: 90,
          symptoms: ['gobbledygook', 'mild discomfort', 'feeling off'],
        },
        ctx,
        'user-1',
      )
      const call = mockAlertEngine.evaluateAdHoc.mock.calls[0][0] as Record<string, any>
      expect(call.symptoms).toBeUndefined()
    })
  })
})
