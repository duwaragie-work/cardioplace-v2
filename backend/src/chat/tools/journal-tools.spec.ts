import { jest } from '@jest/globals'
import {
  getJournalToolDeclarations,
  executeJournalTool,
  normaliseTime,
  mapSymptomsArrayToFlags,
  dedupeSymptomsAgainstFlags,
} from './journal-tools.js'

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

  // ─── Bug 2 + 3 regression guards for the symptom mapper ───────────────────
  // Bug 2: naive substring matching used to flip flags on negation ("no chest
  // pain" → chestPainOrDyspnea=true → false-positive Level-2 alert).
  // Bug 3: the snake_case `face_swelling` (TIER_1_ANGIOEDEMA airway emergency)
  // was missed because the matcher checked "faceswelling" (no underscore)
  // and "face swell" (space) but not the schema key verbatim.
  describe('mapSymptomsArrayToFlags', () => {
    it('flips structured booleans on positive freeform phrases', () => {
      expect(mapSymptomsArrayToFlags(['chest pain'])).toEqual({
        chestPainOrDyspnea: true,
      })
      expect(mapSymptomsArrayToFlags(['dizziness', 'palpitations'])).toEqual({
        dizziness: true,
        palpitations: true,
      })
    })

    it('Bug 2 regression — does NOT flip flags on negation phrases', () => {
      expect(mapSymptomsArrayToFlags(['no chest pain'])).toBeUndefined()
      expect(mapSymptomsArrayToFlags(['denies dizziness'])).toBeUndefined()
      expect(mapSymptomsArrayToFlags(['without headache'])).toBeUndefined()
      expect(mapSymptomsArrayToFlags(['none'])).toBeUndefined()
      expect(mapSymptomsArrayToFlags(['negative for chest pain'])).toBeUndefined()
      expect(mapSymptomsArrayToFlags(['no signs of swelling'])).toBeUndefined()
    })

    it('Bug 2 regression — mixed negated + positive list keeps only the positives', () => {
      expect(
        mapSymptomsArrayToFlags(['no chest pain', 'dizziness', 'denies headache']),
      ).toEqual({ dizziness: true })
    })

    it('Bug 3 regression — face_swelling underscore variant flips faceSwelling', () => {
      expect(mapSymptomsArrayToFlags(['face_swelling'])).toEqual({
        faceSwelling: true,
      })
    })

    it('Bug 3 regression — all snake_case schema keys round-trip', () => {
      expect(mapSymptomsArrayToFlags(['severe_headache'])).toEqual({ severeHeadache: true })
      expect(mapSymptomsArrayToFlags(['chest_pain_or_dyspnea'])).toEqual({ chestPainOrDyspnea: true })
      expect(mapSymptomsArrayToFlags(['altered_mental_status'])).toEqual({ alteredMentalStatus: true })
      expect(mapSymptomsArrayToFlags(['focal_neuro_deficit'])).toEqual({ focalNeuroDeficit: true })
      expect(mapSymptomsArrayToFlags(['throat_tightness'])).toEqual({ throatTightness: true })
    })
  })

  // ─── Bug 23 — server-side dedupe of freeform phrasings against TRUE
  //              structured booleans. Stops the UI showing the same symptom
  //              under both "Symptoms" (boolean label) and "Other symptoms"
  //              (freeform array). Defense-in-depth alongside the prompt
  //              rule telling the LLM not to duplicate.
  describe('dedupeSymptomsAgainstFlags (Bug 23)', () => {
    it('strips "vision changes" phrasing when visualChanges flag is true', () => {
      const out = dedupeSymptomsAgainstFlags(
        ['vision changes', 'throbbing knee pain'],
        { visualChanges: true },
      )
      expect(out).toEqual(['throbbing knee pain'])
    })

    it('keeps everything when no flags are true', () => {
      const out = dedupeSymptomsAgainstFlags(
        ['vision changes', 'throbbing knee pain'],
        { visualChanges: false },
      )
      expect(out).toEqual(['vision changes', 'throbbing knee pain'])
    })

    it('strips multiple distinct duplicates in one pass', () => {
      const out = dedupeSymptomsAgainstFlags(
        ['vision changes', 'chest pain', 'anxiety', 'severe headache'],
        {
          visualChanges: true,
          chestPainOrDyspnea: true,
          severeHeadache: true,
        },
      )
      expect(out).toEqual(['anxiety'])
    })

    it('is case-insensitive (mapSymptomsArrayToFlags lowercases input)', () => {
      const out = dedupeSymptomsAgainstFlags(
        ['Vision Changes', 'VISION CHANGES'],
        { visualChanges: true },
      )
      expect(out).toEqual([])
    })

    it('returns input unchanged when array is empty or undefined', () => {
      expect(dedupeSymptomsAgainstFlags([], { visualChanges: true })).toEqual([])
      expect(dedupeSymptomsAgainstFlags(undefined, { visualChanges: true })).toBeUndefined()
    })

    it('preserves entries that map to a flag that is FALSE / unset', () => {
      // visualChanges is true but the entry maps to chestPainOrDyspnea
      // (which is false), so it should stay.
      const out = dedupeSymptomsAgainstFlags(
        ['chest pain', 'vision changes'],
        { visualChanges: true, chestPainOrDyspnea: false },
      )
      expect(out).toEqual(['chest pain'])
    })

    it('does not strip negated phrasings (mapper already returns no flag)', () => {
      // "no vision changes" doesn't map to visualChanges via the mapper,
      // so it's preserved even when visualChanges is true.
      const out = dedupeSymptomsAgainstFlags(
        ['no vision changes'],
        { visualChanges: true },
      )
      expect(out).toEqual(['no vision changes'])
    })
  })

  describe('getJournalToolDeclarations', () => {
    // Updated 2026-05 — catalog grew from 8 to 9 with the addition of
    // evaluate_reading (chatbot can ask the rule engine what a given
    // BP/HR reading means for this patient, returning the canonical
    // patient-tier message).
    it('should return 12 tool declarations', () => {
      const declarations = getJournalToolDeclarations()
      expect(declarations).toHaveLength(12)
      expect(declarations.map((d) => d.name).sort()).toEqual([
        'check_intake_status',
        'delete_checkin',
        'evaluate_reading',
        'finalize_checkin',
        'flag_emergency',
        'flag_reading_error',
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

    // Regression guard for the "delete/update the last reading" UX. The LLM
    // was previously asking the patient for date+time on natural-language
    // references instead of deriving them via get_recent_readings. The tool
    // descriptions now spell out the target-resolution rule inline so a
    // future edit can't silently drop it. See plan: natural-language
    // delete/update flow.
    it('delete_checkin description spells out natural-language target resolution', () => {
      const declarations = getJournalToolDeclarations()
      const del = declarations.find((d) => d.name === 'delete_checkin')!
      const desc = del.description ?? ''
      expect(desc.toLowerCase()).toContain('get_recent_readings')
      expect(desc.toLowerCase()).toContain('last reading')
      expect(desc.toLowerCase()).toMatch(/do not ask.*date/i)
    })

    it('update_checkin description spells out natural-language target resolution', () => {
      const declarations = getJournalToolDeclarations()
      const update = declarations.find((d) => d.name === 'update_checkin')!
      const desc = update.description ?? ''
      expect(desc.toLowerCase()).toContain('get_recent_readings')
      expect(desc.toLowerCase()).toContain('last reading')
      expect(desc.toLowerCase()).toMatch(/do not ask.*date/i)
    })

    // Bug 21c — pre-fix the get_recent_readings description was narrow
    // ("Use when the patient asks about past readings, trends..."). The LLM
    // didn't reliably route phrases like "give me my readings" or "show me
    // my BP" to this tool. Description now enumerates the common patient
    // phrasings so the LLM has concrete examples to match against.
    it('get_recent_readings description lists patient phrasings (Bug 21c)', () => {
      const declarations = getJournalToolDeclarations()
      const get = declarations.find((d) => d.name === 'get_recent_readings')!
      const desc = (get.description ?? '').toLowerCase()
      expect(desc).toContain('give me my readings')
      expect(desc).toContain('show me my')
      expect(desc).toMatch(/my history|my check-ins|my measurements/)
      expect(desc).toMatch(/last reading|recent bps/)
    })
  })

  describe('executeJournalTool', () => {
    const mockJournalService = {
      create: jest.fn<any>(),
      findAll: jest.fn<any>(),
      update: jest.fn<any>(),
      delete: jest.fn<any>(),
      // Bug 60 — dispatcher reads this for the popup hasActiveMedications
      // signal. Default to true (= patient has meds) so existing test
      // assertions that don't care about this field stay green; the
      // dedicated Bug 60 tests can override per-case.
      hasActiveMedications: jest.fn<any>().mockResolvedValue(true),
    }

    // Lock the wall clock so `new Date().toISOString().slice(0, 10)` (used
    // throughout these tests as "entry_date: todayISO") matches the
    // dispatcher's tz-aware "today" (per Bug 28's NY-local default). 16:00
    // UTC = noon EDT — UTC and NY both fall on the same calendar date, so
    // the future-date guard never spuriously fires when the wallclock has
    // crossed into a UTC-ahead-of-NY window since the test was written.
    beforeAll(() => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date('2026-06-09T16:00:00.000Z'))
    })
    afterAll(() => {
      jest.useRealTimers()
    })

    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('should execute submit_checkin and return saved result', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: '123', systolicBP: 120, diastolicBP: 80 },
      })

      // Updated 2026-06 (Bug 14d) — submit_checkin now rejects readings >30
      // days old. Use today's date so the happy path passes regardless of
      // when the test runs.
      const todayISO = new Date().toISOString().slice(0, 10)
      const result = await executeJournalTool(
        'submit_checkin',
        {
          entry_date: todayISO,
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

    // Bug 59 — service returns noChange:true when every requested field
    // already matches the stored value. Dispatcher must propagate that as
    // updated:false + no_change:true so the LLM doesn't falsely claim
    // "Reading updated successfully." (the canonical message comes from
    // the service and is read back to the patient verbatim).
    it('Bug 59 — chat update_checkin propagates noChange:true from service as no_change in llmResponse', async () => {
      mockJournalService.findAll.mockResolvedValue({
        data: [{ id: '123', measuredAt: '2026-04-07T18:30:00.000Z', systolicBP: 138, diastolicBP: 85 }],
      })
      mockJournalService.update.mockResolvedValue({
        statusCode: 200,
        noChange: true,
        message: 'No changes — the reading already has those values. Nothing to update.',
        data: { id: '123', systolicBP: 138, diastolicBP: 85 },
      })

      const result = await executeJournalTool(
        'update_checkin',
        { entry_date: '2026-04-07', original_time: '14:30', systolic_bp: 138, diastolic_bp: 85 },
        mockJournalService as any,
        'user-1',
      )

      const parsed = JSON.parse(result)
      expect(parsed.updated).toBe(false)
      expect(parsed.no_change).toBe(true)
      expect(parsed.message).toMatch(/already (have|has) those values/i)
    })

    it('should execute update_checkin with date/time lookup', async () => {
      // Bug 27 — LLM passes the patient-local time the LLM saw via
      // get_recent_readings (14:30). Stored measuredAt is UTC. April 7
      // is NY EDT (UTC-4), so 14:30 local = 18:30Z stored. The dispatcher
      // projects measuredAt through ctx.timezone (default NY) before
      // comparing — pre-fix the UTC-slice comparison never matched.
      mockJournalService.findAll.mockResolvedValue({
        data: [{ id: '123', measuredAt: '2026-04-07T18:30:00.000Z', systolicBP: 120, diastolicBP: 80 }],
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

    // ─── Bug 55 — update_checkin must NOT overwrite measuredAt when the
    // LLM is only changing OTHER fields (e.g., systolic_bp). The pre-fix
    // dispatcher fired the measuredAt rebuild branch on every call because
    // `entry_date` is a REQUIRED lookup key (always present), then defaulted
    // the time portion to localNow.time → silently overwrote the saved time
    // with the current clock time on every non-time edit.
    it('Bug 55 — update_checkin with only systolic change does NOT update measuredAt', async () => {
      mockJournalService.findAll.mockResolvedValue({
        data: [{ id: '123', measuredAt: '2026-04-07T18:30:00.000Z', systolicBP: 120, diastolicBP: 80 }],
      })
      mockJournalService.update.mockResolvedValue({
        data: { id: '123', systolicBP: 142 },
      })

      await executeJournalTool(
        'update_checkin',
        {
          entry_date: '2026-04-07',
          original_time: '14:30',
          systolic_bp: 142,
          // No measurement_time → the dispatcher must NOT touch measuredAt.
        },
        mockJournalService as any,
        'user-1',
      )

      const updateArgs = mockJournalService.update.mock.calls[0][2] as Record<string, unknown>
      expect(updateArgs.measuredAt).toBeUndefined()
      expect(updateArgs.systolicBP).toBe(142)
    })

    it('Bug 55 — update_checkin with empty-string measurement_time also leaves measuredAt unchanged', async () => {
      mockJournalService.findAll.mockResolvedValue({
        data: [{ id: '123', measuredAt: '2026-04-07T18:30:00.000Z', systolicBP: 120, diastolicBP: 80 }],
      })
      mockJournalService.update.mockResolvedValue({
        data: { id: '123', systolicBP: 142 },
      })

      await executeJournalTool(
        'update_checkin',
        {
          entry_date: '2026-04-07',
          original_time: '14:30',
          measurement_time: '', // sentinel — leave unchanged
          systolic_bp: 142,
        },
        mockJournalService as any,
        'user-1',
      )

      const updateArgs = mockJournalService.update.mock.calls[0][2] as Record<string, unknown>
      expect(updateArgs.measuredAt).toBeUndefined()
    })

    it('Bug 55 — update_checkin with a real new measurement_time uses entry_date as the date (not today)', async () => {
      mockJournalService.findAll.mockResolvedValue({
        data: [{ id: '123', measuredAt: '2026-04-07T18:30:00.000Z' }],
      })
      mockJournalService.update.mockResolvedValue({
        data: { id: '123', systolicBP: 120 },
      })

      await executeJournalTool(
        'update_checkin',
        {
          entry_date: '2026-04-07',
          original_time: '14:30',
          measurement_time: '15:00', // real new time
        },
        mockJournalService as any,
        'user-1',
      )

      const updateArgs = mockJournalService.update.mock.calls[0][2] as Record<string, unknown>
      // The new measuredAt must be built from entry_date (2026-04-07), not today.
      expect(updateArgs.measuredAt).toBeDefined()
      const newIso = updateArgs.measuredAt as string
      // 2026-04-07 in NY (default tz) at 15:00 → 19:00Z (EDT, UTC-4).
      expect(newIso).toMatch(/^2026-04-07T19:00:00/)
    })

    // ─── Bug 54 — submit/update response must include weight_display so
    // the LLM can verbalise back in the unit the patient said, instead of
    // remembering and sometimes mismatching ("Saved 80 lbs" when patient
    // said "80 kg").
    it('Bug 54 — submit_checkin response includes weight_display.verbalize_as in the unit the patient said (KG)', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'e1', weight: 80, systolicBP: 120, diastolicBP: 80 },
      })

      const result = await executeJournalTool(
        'submit_checkin',
        {
          entry_date: '2026-06-01',
          measurement_time: '08:30',
          systolic_bp: 120,
          diastolic_bp: 80,
          medication_taken: true,
          symptoms: [],
          weight: 80,
          weight_unit: 'KG',
        },
        mockJournalService as any,
        'user-1',
      )

      const parsed = JSON.parse(result)
      expect(parsed.weight_display).toBeDefined()
      expect(parsed.weight_display.original_unit).toBe('KG')
      expect(parsed.weight_display.verbalize_as).toMatch(/80\s*kg/i)
      expect(parsed.weight_display.kg).toBe(80)
      expect(parsed.weight_display.lbs).toBeGreaterThan(170)
    })

    it('Bug 54 — submit_checkin response uses LBS verbalisation when the patient said LBS', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'e1', weight: 81.65, systolicBP: 120, diastolicBP: 80 }, // 180 lbs ≈ 81.65 kg
      })

      const result = await executeJournalTool(
        'submit_checkin',
        {
          entry_date: '2026-06-01',
          measurement_time: '08:30',
          systolic_bp: 120,
          diastolic_bp: 80,
          medication_taken: true,
          symptoms: [],
          weight: 180,
          weight_unit: 'LBS',
        },
        mockJournalService as any,
        'user-1',
      )

      const parsed = JSON.parse(result)
      expect(parsed.weight_display.original_unit).toBe('LBS')
      expect(parsed.weight_display.verbalize_as).toMatch(/\d+(\.\d+)?\s*lbs/i)
    })

    it('should execute delete_checkin with date/time lookup', async () => {
      mockJournalService.findAll.mockResolvedValue({
        data: [{ id: '123', measuredAt: '2026-04-07T18:30:00.000Z' }],
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

    // ─── Layer 3 — intake-incomplete error translation ─────────────────────
    // The backend gate at daily_journal.service.ts:37-58 throws a
    // ForbiddenException with response.message='clinical-intake-required'
    // when the patient has no PatientProfile. The dispatcher catches that
    // exception specifically and returns a structured INTAKE_INCOMPLETE
    // payload so the LLM can route the patient instead of saying
    // "I couldn't save it."
    it('translates ForbiddenException(clinical-intake-required) into INTAKE_INCOMPLETE on submit_checkin', async () => {
      const intakeError: any = new Error('Forbidden')
      intakeError.name = 'ForbiddenException'
      intakeError.status = 403
      intakeError.response = { message: 'clinical-intake-required' }
      mockJournalService.create.mockRejectedValue(intakeError)

      const result = await executeJournalTool(
        'submit_checkin',
        {
          entry_date: '2026-06-01',
          measurement_time: '08:30',
          systolic_bp: 120,
          diastolic_bp: 80,
          medication_taken: true,
          symptoms: [],
        },
        mockJournalService as any,
        'user-1',
      )

      const parsed = JSON.parse(result)
      expect(parsed).toEqual({
        saved: false,
        reason: 'INTAKE_INCOMPLETE',
        intake_url: '/clinical-intake',
        message: expect.stringContaining('/clinical-intake'),
      })
    })

    it('check_intake_status returns completed=true when service reports profile exists', async () => {
      const ctx = {
        journalService: mockJournalService as any,
        intakeStatusService: {
          getStatus: jest.fn<any>().mockResolvedValue({ completed: true, profileExists: true }),
        },
      }
      const result = await executeJournalTool('check_intake_status', {}, ctx as any, 'user-1')
      const parsed = JSON.parse(result)
      expect(parsed.completed).toBe(true)
      expect(parsed.profile_exists).toBe(true)
      expect(parsed.intake_url).toBe('/clinical-intake')
      expect(ctx.intakeStatusService.getStatus).toHaveBeenCalledWith('user-1')
    })

    it('check_intake_status returns completed=false + nudges to /clinical-intake when profile missing', async () => {
      const ctx = {
        journalService: mockJournalService as any,
        intakeStatusService: {
          getStatus: jest.fn<any>().mockResolvedValue({ completed: false, profileExists: false }),
        },
      }
      const result = await executeJournalTool('check_intake_status', {}, ctx as any, 'user-1')
      const parsed = JSON.parse(result)
      expect(parsed.completed).toBe(false)
      expect(parsed.profile_exists).toBe(false)
      expect(parsed.message).toMatch(/clinical-intake/i)
    })

    it('check_intake_status falls back gracefully when intakeStatusService is absent (legacy callers)', async () => {
      const ctx = { journalService: mockJournalService as any }
      const result = await executeJournalTool('check_intake_status', {}, ctx as any, 'user-1')
      const parsed = JSON.parse(result)
      expect(parsed.completed).toBe(false)
      expect(parsed.intake_url).toBe('/clinical-intake')
      expect(parsed.message).toMatch(/unavailable/i)
    })

    // ─── Bug 13 — OCR verbal-confirmation guard ─────────────────────────
    // submit_bp_from_photo stamps ocrState.lastAt + clears userMessageSince.
    // The chat streaming loop flips userMessageSince=true when a new patient
    // message arrives. submit_checkin must REFUSE inside the 30s window
    // until the patient has actually spoken again (read-back-and-confirm).
    it('submit_checkin: rejects with OCR_UNCONFIRMED when called immediately after OCR (no user turn)', async () => {
      const ocrState = { lastAt: Date.now(), userMessageSince: false }
      const ctx = {
        journalService: mockJournalService as any,
        ocrState,
      }
      const result = await executeJournalTool(
        'submit_checkin',
        {
          entry_date: '2026-06-01',
          measurement_time: '08:30',
          systolic_bp: 138,
          diastolic_bp: 84,
          medication_taken: true,
          symptoms: [],
        },
        ctx as any,
        'user-1',
      )
      const parsed = JSON.parse(result)
      expect(parsed).toEqual(
        expect.objectContaining({
          saved: false,
          reason: 'OCR_UNCONFIRMED',
        }),
      )
      expect(mockJournalService.create).not.toHaveBeenCalled()
    })

    it('submit_checkin: proceeds normally when the patient has spoken since OCR', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'ok', systolicBP: 138, diastolicBP: 84 },
      })
      const ocrState = { lastAt: Date.now(), userMessageSince: true }
      const ctx = {
        journalService: mockJournalService as any,
        ocrState,
      }
      const result = await executeJournalTool(
        'submit_checkin',
        {
          entry_date: '2026-06-01',
          measurement_time: '08:30',
          systolic_bp: 138,
          diastolic_bp: 84,
          medication_taken: true,
          symptoms: [],
        },
        ctx as any,
        'user-1',
      )
      const parsed = JSON.parse(result)
      expect(parsed.saved).toBe(true)
      expect(mockJournalService.create).toHaveBeenCalledTimes(1)
    })

    it('submit_checkin: proceeds normally when the OCR is older than the 30s window', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'ok', systolicBP: 138, diastolicBP: 84 },
      })
      // userMessageSince=false but OCR is 31s old → window expired
      const ocrState = { lastAt: Date.now() - 31_000, userMessageSince: false }
      const ctx = {
        journalService: mockJournalService as any,
        ocrState,
      }
      const result = await executeJournalTool(
        'submit_checkin',
        {
          entry_date: '2026-06-01',
          measurement_time: '08:30',
          systolic_bp: 138,
          diastolic_bp: 84,
          medication_taken: true,
          symptoms: [],
        },
        ctx as any,
        'user-1',
      )
      const parsed = JSON.parse(result)
      expect(parsed.saved).toBe(true)
    })

    // ─── Bug 18 — wallclock-to-UTC conversion uses ctx.timezone ──────────
    // Pre-fix: dispatcher did `new Date(\`${date}T${time}:00.000Z\`)` which
    // treated the patient's wallclock as UTC. A patient in IST saying
    // "3:32 PM" was stored as 15:32Z, then My Readings rendered that UTC
    // instant in client-local (+5:30) → "9:02 PM". Voice already used the
    // shared helper; text chat now does too.
    it('submit_checkin: converts IST wallclock to correct UTC instant via ctx.timezone', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'ok', systolicBP: 130, diastolicBP: 90 },
      })
      const today = new Date().toISOString().slice(0, 10)
      const ctx = {
        journalService: mockJournalService as any,
        timezone: 'Asia/Kolkata', // IST = UTC+5:30
      }
      await executeJournalTool(
        'submit_checkin',
        {
          entry_date: today,
          measurement_time: '15:32', // 3:32 PM IST
          systolic_bp: 130,
          diastolic_bp: 90,
          medication_taken: true,
          symptoms: [],
        },
        ctx as any,
        'user-1',
      )
      expect(mockJournalService.create).toHaveBeenCalledTimes(1)
      const dto = mockJournalService.create.mock.calls[0][1] as { measuredAt: string }
      // 15:32 IST → 10:02 UTC. Pre-fix this was 15:32:00.000Z (wrong).
      expect(dto.measuredAt).toBe(`${today}T10:02:00.000Z`)
    })

    it('submit_checkin: falls back gracefully when ctx.timezone is unset (NOT wallclock-as-UTC)', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'ok', systolicBP: 130, diastolicBP: 90 },
      })
      const today = new Date().toISOString().slice(0, 10)
      const ctx = {
        journalService: mockJournalService as any,
        // timezone omitted — exercises the back-compat fallback path
      }
      await executeJournalTool(
        'submit_checkin',
        {
          entry_date: today,
          measurement_time: '15:32',
          systolic_bp: 120,
          diastolic_bp: 80,
          medication_taken: true,
          symptoms: [],
        },
        ctx as any,
        'user-1',
      )
      expect(mockJournalService.create).toHaveBeenCalledTimes(1)
      const dto = mockJournalService.create.mock.calls[0][1] as { measuredAt: string }
      // The pre-fix bug produced exactly this string. After the fix, the
      // helper applies America/New_York's offset (4 or 5h depending on DST)
      // so the wallclock no longer leaks through verbatim. Asserting "not
      // equal" sidesteps the DST edge while still proving the fix is live.
      expect(dto.measuredAt).not.toBe(`${today}T15:32:00.000Z`)
      // And the result is still a well-formed ISO UTC instant.
      expect(dto.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/)
    })

    // ─── Bug 19 — weight lbs→kg conversion at dispatcher ────────────────
    // Tool description tells the LLM to pass weight in lbs; system prompt
    // reinforces it. JournalEntry.weight is stored in kg. Dispatcher must
    // convert before writing — pre-fix it persisted the lbs value as kg,
    // and the readings page then re-multiplied for display (150 → 330.7).
    it('submit_checkin: converts patient lbs weight to kg before persisting', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'ok', systolicBP: 120, diastolicBP: 80 },
      })
      const today = new Date().toISOString().slice(0, 10)
      const ctx = { journalService: mockJournalService as any }
      await executeJournalTool(
        'submit_checkin',
        {
          entry_date: today,
          measurement_time: '09:00',
          systolic_bp: 120,
          diastolic_bp: 80,
          weight: 150, // patient said "150 lbs"
          medication_taken: true,
          symptoms: [],
        },
        ctx as any,
        'user-1',
      )
      expect(mockJournalService.create).toHaveBeenCalledTimes(1)
      const dto = mockJournalService.create.mock.calls[0][1] as { weight: number }
      // Bug 24 — 150 × 0.45359237 = 68.0388555 → rounded to TWO decimals
      // = 68.04 kg. Two-dp precision is needed so the kg→lbs display
      // round-trip stays clean (68.04 / 0.45359237 = 150.00 lbs).
      expect(dto.weight).toBe(68.04)
    })

    // Bug 24 — round-trip regression. Confirms that the kg value persisted
    // for common integer-lbs inputs round-trips back to the same lbs at
    // 1-decimal-place display precision. Pre-fix the kg column was rounded
    // to 1 dp which caused 145, 150, 160, 165 lbs to drift by 0.1 on
    // display (e.g. "150 lbs" stored 68.0 kg, displayed 149.9 lbs).
    it.each([140, 145, 150, 155, 160, 165, 175, 200])(
      'submit_checkin: Bug 24 round-trip — %i lbs stored as kg round-trips back to the same lbs (1dp)',
      async (lbs) => {
        mockJournalService.create.mockResolvedValue({
          data: { id: 'ok', systolicBP: 120, diastolicBP: 80 },
        })
        const today = new Date().toISOString().slice(0, 10)
        const ctx = { journalService: mockJournalService as any }
        await executeJournalTool(
          'submit_checkin',
          {
            entry_date: today,
            measurement_time: '09:00',
            systolic_bp: 120,
            diastolic_bp: 80,
            weight: lbs,
            medication_taken: true,
            symptoms: [],
          },
          ctx as any,
          'user-1',
        )
        const dto = mockJournalService.create.mock.calls[0][1] as { weight: number }
        // Simulate the frontend's kg→lbs display conversion (kg / KG_PER_LB,
        // rounded to 1 dp). MUST equal the original lbs input.
        const displayLbs = Math.round((dto.weight / 0.45359237) * 10) / 10
        expect(displayLbs).toBe(lbs)
      },
    )

    it('submit_checkin: omits weight when args.weight is 0', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'ok', systolicBP: 120, diastolicBP: 80 },
      })
      const today = new Date().toISOString().slice(0, 10)
      const ctx = { journalService: mockJournalService as any }
      await executeJournalTool(
        'submit_checkin',
        {
          entry_date: today,
          measurement_time: '09:00',
          systolic_bp: 120,
          diastolic_bp: 80,
          weight: 0,
          medication_taken: true,
          symptoms: [],
        },
        ctx as any,
        'user-1',
      )
      const dto = mockJournalService.create.mock.calls[0][1] as { weight?: number }
      // Skipped weight should not land as 0 kg — must be omitted entirely.
      expect(dto.weight).toBeUndefined()
    })

    // ─── kg/lbs follow-up — weight_unit arg handling ────────────────────
    // Tool now accepts BOTH units; LLM passes the unit the patient said.
    // Backend normalises to kg before persisting. Default = LBS for
    // back-compat with the pre-feature contract.
    it('submit_checkin: weight_unit="KG" persists weight raw (no conversion)', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'ok', systolicBP: 120, diastolicBP: 80 },
      })
      const today = new Date().toISOString().slice(0, 10)
      const ctx = { journalService: mockJournalService as any }
      await executeJournalTool(
        'submit_checkin',
        {
          entry_date: today,
          measurement_time: '09:00',
          systolic_bp: 120,
          diastolic_bp: 80,
          weight: 68, // patient said "68 kg"
          weight_unit: 'KG',
          medication_taken: true,
          symptoms: [],
        },
        ctx as any,
        'user-1',
      )
      const dto = mockJournalService.create.mock.calls[0][1] as { weight: number }
      // 68 kg — stored as-is (rounded to 1 decimal).
      expect(dto.weight).toBe(68.0)
    })

    it('submit_checkin: weight_unit="LBS" converts to kg', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'ok', systolicBP: 120, diastolicBP: 80 },
      })
      const today = new Date().toISOString().slice(0, 10)
      const ctx = { journalService: mockJournalService as any }
      await executeJournalTool(
        'submit_checkin',
        {
          entry_date: today,
          measurement_time: '09:00',
          systolic_bp: 120,
          diastolic_bp: 80,
          weight: 150,
          weight_unit: 'LBS',
          medication_taken: true,
          symptoms: [],
        },
        ctx as any,
        'user-1',
      )
      const dto = mockJournalService.create.mock.calls[0][1] as { weight: number }
      // Bug 24 — same 2-dp precision as the default-LBS branch above.
      expect(dto.weight).toBe(68.04)
    })

    it('submit_checkin: weight_unit lowercase "kg" still matches (case-insensitive)', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'ok', systolicBP: 120, diastolicBP: 80 },
      })
      const today = new Date().toISOString().slice(0, 10)
      const ctx = { journalService: mockJournalService as any }
      await executeJournalTool(
        'submit_checkin',
        {
          entry_date: today,
          measurement_time: '09:00',
          systolic_bp: 120,
          diastolic_bp: 80,
          weight: 75,
          weight_unit: 'kg',
          medication_taken: true,
          symptoms: [],
        },
        ctx as any,
        'user-1',
      )
      const dto = mockJournalService.create.mock.calls[0][1] as { weight: number }
      expect(dto.weight).toBe(75.0)
    })

    it('update_checkin: weight_unit="KG" persists raw on update', async () => {
      mockJournalService.update.mockResolvedValue({
        data: { id: 'entry-1', systolicBP: 120, diastolicBP: 80 },
      })
      const ctx = { journalService: mockJournalService as any }
      await executeJournalTool(
        'update_checkin',
        { entry_id: 'entry-1', weight: 90, weight_unit: 'KG' },
        ctx as any,
        'user-1',
      )
      const dto = mockJournalService.update.mock.calls[0][2] as { weight: number }
      expect(dto.weight).toBe(90.0)
    })

    it('update_checkin: applies same lbs→kg conversion when weight is updated', async () => {
      mockJournalService.update.mockResolvedValue({
        data: { id: 'entry-1', systolicBP: 120, diastolicBP: 80 },
      })
      const ctx = { journalService: mockJournalService as any }
      await executeJournalTool(
        'update_checkin',
        { entry_id: 'entry-1', weight: 200 },
        ctx as any,
        'user-1',
      )
      expect(mockJournalService.update).toHaveBeenCalledTimes(1)
      const dto = mockJournalService.update.mock.calls[0][2] as { weight: number }
      // Bug 24 — 200 × 0.45359237 = 90.718474 → 2 dp = 90.72 kg.
      expect(dto.weight).toBe(90.72)
    })

    it('update_checkin: applies ctx.timezone when only measurement_time changes', async () => {
      mockJournalService.update.mockResolvedValue({
        data: { id: 'entry-1', systolicBP: 130, diastolicBP: 90 },
      })
      const ctx = {
        journalService: mockJournalService as any,
        timezone: 'Asia/Kolkata',
      }
      await executeJournalTool(
        'update_checkin',
        {
          entry_id: 'entry-1',
          entry_date: '2026-06-05',
          measurement_time: '15:32',
        },
        ctx as any,
        'user-1',
      )
      expect(mockJournalService.update).toHaveBeenCalledTimes(1)
      const dto = mockJournalService.update.mock.calls[0][2] as { measuredAt: string }
      expect(dto.measuredAt).toBe('2026-06-05T10:02:00.000Z')
    })

    it('submit_checkin: proceeds normally when no ocrState in context (no OCR happened)', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'ok', systolicBP: 138, diastolicBP: 84 },
      })
      const ctx = {
        journalService: mockJournalService as any,
        // ocrState omitted entirely
      }
      const result = await executeJournalTool(
        'submit_checkin',
        {
          entry_date: '2026-06-01',
          measurement_time: '08:30',
          systolic_bp: 138,
          diastolic_bp: 84,
          medication_taken: true,
          symptoms: [],
        },
        ctx as any,
        'user-1',
      )
      const parsed = JSON.parse(result)
      expect(parsed.saved).toBe(true)
    })

    // ─── Bug 14d — 30-day stale-reading reject ────────────────────────
    // The BP check-in form blocks readings older than 30 days. Mirror that
    // limit on the chatbot so backfilling old readings doesn't skew the
    // session-averaging windows + pre-day-3 personalization gate.
    it('submit_checkin: rejects readings older than 30 days with STALE_READING', async () => {
      const staleDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
      const result = await executeJournalTool(
        'submit_checkin',
        {
          entry_date: staleDate,
          measurement_time: '08:30',
          systolic_bp: 138,
          diastolic_bp: 84,
          medication_taken: true,
          symptoms: [],
        },
        mockJournalService as any,
        'user-1',
      )
      const parsed = JSON.parse(result)
      expect(parsed).toEqual(
        expect.objectContaining({
          saved: false,
          reason: 'STALE_READING',
        }),
      )
      expect(mockJournalService.create).not.toHaveBeenCalled()
    })

    it('submit_checkin: accepts a reading exactly 29 days old', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'ok', systolicBP: 138, diastolicBP: 84 },
      })
      const okDate = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
      const result = await executeJournalTool(
        'submit_checkin',
        {
          entry_date: okDate,
          measurement_time: '08:30',
          systolic_bp: 138,
          diastolic_bp: 84,
          medication_taken: true,
          symptoms: [],
        },
        mockJournalService as any,
        'user-1',
      )
      const parsed = JSON.parse(result)
      expect(parsed.saved).toBe(true)
    })

    // ─── Bug 16A — medication_taken / missed_medications invariant ─────
    // The LLM sometimes passes contradictory state: medication_taken=true
    // alongside a non-empty missed_medications array. Backend normalises
    // medication_taken to FALSE when the array is non-empty so the rule
    // engine, audit log, and downstream UI never see "All taken" alongside
    // a missed-med record.
    it('submit_checkin: normalises medication_taken=false when missed_medications is non-empty', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'ok', medicationTaken: false, missedMedications: [] },
      })
      const todayISO = new Date().toISOString().slice(0, 10)
      await executeJournalTool(
        'submit_checkin',
        {
          entry_date: todayISO,
          measurement_time: '08:30',
          systolic_bp: 130,
          diastolic_bp: 90,
          medication_taken: true, // ← LLM passed contradictory rollup
          missed_medications: [
            { drug_name: 'Norvasc', reason: 'FORGOT', missed_doses: 1 },
          ],
          symptoms: ['headache'],
        },
        mockJournalService as any,
        'user-1',
      )
      const callArg = mockJournalService.create.mock.calls[0][1] as Record<string, unknown>
      // Despite the LLM passing medication_taken=true, the dispatcher
      // normalised to false because missed_medications is non-empty.
      expect(callArg.medicationTaken).toBe(false)
      // missed_medications still threaded through.
      expect(Array.isArray(callArg.missedMedications)).toBe(true)
      expect(((callArg.missedMedications as unknown[]) ?? []).length).toBe(1)
    })

    it('submit_checkin: leaves medication_taken=true alone when missed_medications is empty/missing', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'ok', medicationTaken: true },
      })
      const todayISO = new Date().toISOString().slice(0, 10)
      await executeJournalTool(
        'submit_checkin',
        {
          entry_date: todayISO,
          measurement_time: '08:30',
          systolic_bp: 130,
          diastolic_bp: 90,
          medication_taken: true,
          symptoms: [],
          // missed_medications omitted
        },
        mockJournalService as any,
        'user-1',
      )
      const callArg = mockJournalService.create.mock.calls[0][1] as Record<string, unknown>
      expect(callArg.medicationTaken).toBe(true)
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
      // Bug 60 — dispatcher reads this for the popup hasActiveMedications
      // signal. Default to true (= patient has meds) so existing test
      // assertions that don't care about this field stay green; the
      // dedicated Bug 60 tests can override per-case.
      hasActiveMedications: jest.fn<any>().mockResolvedValue(true),
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

  // ==========================================================================
  // Phase/16 — submit_checkin new flags: close_session, confirms_entry_id,
  // decline_confirmation (Nivakaran chat-v2 handoff 2026-06-17)
  // ==========================================================================
  describe('Phase/16 submit_checkin new flags', () => {
    const mockJournalService = {
      create: jest.fn<any>(),
      findAll: jest.fn<any>(),
      update: jest.fn<any>(),
      delete: jest.fn<any>(),
      hasActiveMedications: jest.fn<any>().mockResolvedValue(true),
      finalizeUnconfirmedEmergency: jest.fn<any>(),
    }

    beforeAll(() => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date('2026-06-17T16:00:00.000Z'))
    })
    afterAll(() => {
      jest.useRealTimers()
    })

    beforeEach(() => {
      jest.clearAllMocks()
    })

    const todayISO = '2026-06-17'

    it('schema declares close_session, confirms_entry_id, decline_confirmation', () => {
      const declarations = getJournalToolDeclarations()
      const submit = declarations.find((d) => d.name === 'submit_checkin')!
      const props = submit.parameters!.properties as Record<string, any>
      expect(props).toHaveProperty('close_session')
      expect(props).toHaveProperty('confirms_entry_id')
      expect(props).toHaveProperty('decline_confirmation')
      expect(props).toHaveProperty('session_id')
    })

    it('close_session=true threads into journalService.create as closeSession', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'j1', systolicBP: 130, diastolicBP: 85 },
      })
      await executeJournalTool(
        'submit_checkin',
        {
          entry_date: todayISO,
          measurement_time: '08:30',
          systolic_bp: 130,
          diastolic_bp: 85,
          medication_taken: true,
          symptoms: [],
          close_session: true,
        },
        mockJournalService as any,
        'user-1',
      )
      expect(mockJournalService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ closeSession: true }),
      )
    })

    it('close_session omitted defaults to false in the DTO', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'j2', systolicBP: 130, diastolicBP: 85 },
      })
      await executeJournalTool(
        'submit_checkin',
        {
          entry_date: todayISO,
          measurement_time: '08:30',
          systolic_bp: 130,
          diastolic_bp: 85,
          medication_taken: true,
          symptoms: [],
        },
        mockJournalService as any,
        'user-1',
      )
      expect(mockJournalService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ closeSession: false }),
      )
    })

    it('confirms_entry_id threads into the DTO trimmed', async () => {
      mockJournalService.create.mockResolvedValue({
        data: { id: 'j3', systolicBP: 138, diastolicBP: 88 },
      })
      await executeJournalTool(
        'submit_checkin',
        {
          entry_date: todayISO,
          measurement_time: '14:32',
          systolic_bp: 138,
          diastolic_bp: 88,
          medication_taken: true,
          symptoms: [],
          confirms_entry_id: '  await-abc  ',
          close_session: true,
        },
        mockJournalService as any,
        'user-1',
      )
      expect(mockJournalService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ confirmsEntryId: 'await-abc' }),
      )
    })

    it('decline_confirmation=true bypasses create and routes to finalizeUnconfirmedEmergency', async () => {
      mockJournalService.finalizeUnconfirmedEmergency.mockResolvedValue({
        statusCode: 202,
        message: 'Held entry resolved as UNCONFIRMED.',
      })
      const result = await executeJournalTool(
        'submit_checkin',
        {
          entry_date: todayISO,
          measurement_time: '14:32',
          systolic_bp: 0,
          diastolic_bp: 0,
          medication_taken: true,
          symptoms: [],
          decline_confirmation: true,
          confirms_entry_id: 'await-xyz',
        },
        mockJournalService as any,
        'user-1',
      )
      const parsed = JSON.parse(result)
      expect(parsed.declined).toBe(true)
      expect(mockJournalService.finalizeUnconfirmedEmergency).toHaveBeenCalledWith(
        'user-1',
        'await-xyz',
      )
      // The normal create path MUST NOT run for a decline.
      expect(mockJournalService.create).not.toHaveBeenCalled()
    })

    it('decline_confirmation=true WITHOUT confirms_entry_id is rejected (no DB writes)', async () => {
      const result = await executeJournalTool(
        'submit_checkin',
        {
          entry_date: todayISO,
          measurement_time: '14:32',
          systolic_bp: 0,
          diastolic_bp: 0,
          medication_taken: true,
          symptoms: [],
          decline_confirmation: true,
        },
        mockJournalService as any,
        'user-1',
      )
      const parsed = JSON.parse(result)
      expect(parsed.saved).toBe(false)
      expect(parsed.reason).toBe('DECLINE_WITHOUT_ID')
      expect(mockJournalService.create).not.toHaveBeenCalled()
      expect(mockJournalService.finalizeUnconfirmedEmergency).not.toHaveBeenCalled()
    })
  })
})
