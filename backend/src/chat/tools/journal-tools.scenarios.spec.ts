// End-to-end scenario tests for every text-chat tool. Each describe block
// exercises happy path + sad path + the most common patient phrasings the
// LLM has to convert into structured arguments.
//
// Style notes:
//   • Each scenario test names the phrasing it simulates, so failure
//     messages map straight to a clinical conversation flow.
//   • Date-coercion tests use the live system clock (we lock "today" /
//     "now" to the literal-string fallbacks because normaliseDate /
//     normaliseTime return today's date at test time).
//   • Per CLAUDE.md guidance these tests do NOT rely on a live LLM —
//     they exercise the executor and helpers directly.
//
// Run via:
//   NODE_OPTIONS=--experimental-vm-modules \
//     npx jest --testPathPatterns="journal-tools.scenarios"

import { jest } from '@jest/globals'
import {
  executeJournalTool,
  normaliseDate,
  normaliseTime,
  normalisePosition,
  sanitiseMeasurementConditions,
  normaliseMissedMedications,
} from './journal-tools.js'

// ─── Shared mock harness ──────────────────────────────────────────────────────

function makeCtx() {
  return {
    journalService: {
      create: jest.fn<any>().mockResolvedValue({ data: { id: 'entry-1' } }),
      findAll: jest.fn<any>().mockResolvedValue({ data: [] }),
      findOne: jest.fn<any>().mockResolvedValue({ data: {} }),
      update: jest.fn<any>().mockResolvedValue({ data: {} }),
      delete: jest.fn<any>().mockResolvedValue(undefined),
    },
    adherenceService: {
      log: jest.fn<any>().mockResolvedValue({ logged: true, message: 'Logged.' }),
    },
    symptomService: {
      log: jest.fn<any>().mockResolvedValue({
        logged: true,
        message: 'Symptom logged.',
        symptom: 'severeHeadache',
        entryId: 'entry-2',
      }),
    },
    ocrService: {
      extractBp: jest.fn<any>().mockResolvedValue({
        sbp: 138,
        dbp: 84,
        pulse: 72,
        confidence: 0.92,
      }),
    },
  }
}

const USER = 'user-test-1'

// ─── normalisers ──────────────────────────────────────────────────────────────

describe('normalisers (text chat)', () => {
  describe('normaliseDate', () => {
    it('passes through canonical YYYY-MM-DD', () => {
      expect(normaliseDate('2026-05-20')).toBe('2026-05-20')
    })
    it('handles "today" / "now" / "right now" / "just now"', () => {
      const today = new Date().toISOString().slice(0, 10)
      expect(normaliseDate('today')).toBe(today)
      expect(normaliseDate('NOW')).toBe(today)
      expect(normaliseDate('right now')).toBe(today)
      expect(normaliseDate('just now')).toBe(today)
    })
    it('handles "yesterday"', () => {
      const y = new Date()
      y.setUTCDate(y.getUTCDate() - 1)
      expect(normaliseDate('yesterday')).toBe(y.toISOString().slice(0, 10))
    })
    it('returns undefined for free-text', () => {
      expect(normaliseDate('last Tuesday')).toBeUndefined()
      expect(normaliseDate('')).toBeUndefined()
      expect(normaliseDate(undefined)).toBeUndefined()
    })
  })

  describe('normalisePosition', () => {
    it('accepts canonical enums', () => {
      expect(normalisePosition('SITTING')).toBe('SITTING')
      expect(normalisePosition('lying')).toBe('LYING')
    })
    it('maps common synonyms', () => {
      expect(normalisePosition('seated')).toBe('SITTING')
      expect(normalisePosition('stood')).toBe('STANDING')
      expect(normalisePosition('laying')).toBe('LYING')
    })
    it('returns undefined for unknown', () => {
      expect(normalisePosition('on the floor')).toBeUndefined()
      expect(normalisePosition(undefined)).toBeUndefined()
    })
  })

  describe('sanitiseMeasurementConditions', () => {
    it('keeps only known boolean keys', () => {
      const out = sanitiseMeasurementConditions({
        noCaffeine: true,
        seatedQuietly: false,
        notAKey: true,
        cuffOnBareArm: 'yes', // wrong type — dropped
      })
      expect(out).toEqual({ noCaffeine: true, seatedQuietly: false })
    })
    it('returns undefined for empty', () => {
      expect(sanitiseMeasurementConditions({})).toBeUndefined()
      expect(sanitiseMeasurementConditions(null)).toBeUndefined()
    })
  })

  describe('normaliseMissedMedications', () => {
    it('coerces snake_case + camelCase', () => {
      const out = normaliseMissedMedications([
        { drug_name: 'Lisinopril', reason: 'forgot' },
        { drugName: 'Atorvastatin', reason: 'COST', missed_doses: 2 },
      ])
      expect(out).toEqual([
        { drugName: 'Lisinopril', reason: 'FORGOT', missedDoses: 1 },
        { drugName: 'Atorvastatin', reason: 'COST', missedDoses: 2 },
      ])
    })
    it('drops rows with invalid reason', () => {
      const out = normaliseMissedMedications([
        { drug_name: 'Lisinopril', reason: 'i felt like it' },
      ])
      expect(out).toBeUndefined()
    })
    it('clamps missed_doses to 1..10', () => {
      const out = normaliseMissedMedications([
        { drug_name: 'X', reason: 'FORGOT', missed_doses: 999 },
        { drug_name: 'Y', reason: 'FORGOT', missed_doses: -5 },
      ])
      expect(out).toEqual([
        { drugName: 'X', reason: 'FORGOT', missedDoses: 10 },
        { drugName: 'Y', reason: 'FORGOT', missedDoses: 1 },
      ])
    })
  })
})

// ─── submit_checkin ───────────────────────────────────────────────────────────

describe('submit_checkin scenarios', () => {
  it('happy path: required fields → calls journal.create + returns saved:true', async () => {
    const ctx = makeCtx()
    const result = await executeJournalTool(
      'submit_checkin',
      {
        entry_date: '2026-05-20',
        measurement_time: '08:30',
        systolic_bp: 132,
        diastolic_bp: 86,
        medication_taken: true,
        symptoms: [],
      },
      ctx as any,
      USER,
    )
    expect(JSON.parse(result).saved).toBe(true)
    expect(ctx.journalService.create).toHaveBeenCalledTimes(1)
  })

  it('rejects when measurement_time is missing (gate fires first)', async () => {
    const ctx = makeCtx()
    const result = await executeJournalTool(
      'submit_checkin',
      {
        entry_date: '2026-05-20',
        systolic_bp: 132,
        diastolic_bp: 86,
        medication_taken: true,
        symptoms: [],
      },
      ctx as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.saved).toBe(false)
    expect(parsed._internal).toBe(true)
    expect(parsed.next_action).toMatch(/measurement_time/)
    expect(ctx.journalService.create).not.toHaveBeenCalled()
  })

  it('rejects when medication_taken is null/undefined', async () => {
    const ctx = makeCtx()
    const result = await executeJournalTool(
      'submit_checkin',
      {
        entry_date: '2026-05-20',
        measurement_time: '08:30',
        systolic_bp: 132,
        diastolic_bp: 86,
        symptoms: [],
      },
      ctx as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.saved).toBe(false)
    expect(parsed.next_action).toMatch(/medication_taken/)
    expect(ctx.journalService.create).not.toHaveBeenCalled()
  })

  it('rejects when symptoms is missing entirely (not just empty)', async () => {
    const ctx = makeCtx()
    const result = await executeJournalTool(
      'submit_checkin',
      {
        entry_date: '2026-05-20',
        measurement_time: '08:30',
        systolic_bp: 132,
        diastolic_bp: 86,
        medication_taken: true,
      },
      ctx as any,
      USER,
    )
    expect(JSON.parse(result).saved).toBe(false)
  })

  it('accepts empty symptoms array as "none reported"', async () => {
    const ctx = makeCtx()
    const result = await executeJournalTool(
      'submit_checkin',
      {
        entry_date: '2026-05-20',
        measurement_time: '08:30',
        systolic_bp: 120,
        diastolic_bp: 80,
        medication_taken: true,
        symptoms: [],
      },
      ctx as any,
      USER,
    )
    expect(JSON.parse(result).saved).toBe(true)
  })

  it('blocks future-dated entries', async () => {
    const ctx = makeCtx()
    const future = new Date()
    future.setUTCDate(future.getUTCDate() + 7)
    const result = await executeJournalTool(
      'submit_checkin',
      {
        entry_date: future.toISOString().slice(0, 10),
        measurement_time: '08:30',
        systolic_bp: 120,
        diastolic_bp: 80,
        medication_taken: true,
        symptoms: [],
      },
      ctx as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.saved).toBe(false)
    expect(parsed.message.toLowerCase()).toContain('future date')
    expect(ctx.journalService.create).not.toHaveBeenCalled()
  })

  it('threads structured Stage A symptom booleans (severe_headache)', async () => {
    const ctx = makeCtx()
    await executeJournalTool(
      'submit_checkin',
      {
        entry_date: '2026-05-20',
        measurement_time: '08:30',
        systolic_bp: 158,
        diastolic_bp: 95,
        medication_taken: true,
        symptoms: [],
        severe_headache: true,
        visual_changes: false,
      },
      ctx as any,
      USER,
    )
    const dto = ctx.journalService.create.mock.calls[0][1] as Record<string, unknown>
    expect(dto.severeHeadache).toBe(true)
    expect(dto.visualChanges).toBe(false)
  })

  it('threads missed_medications through normalisation', async () => {
    const ctx = makeCtx()
    await executeJournalTool(
      'submit_checkin',
      {
        entry_date: '2026-05-20',
        measurement_time: '08:30',
        systolic_bp: 145,
        diastolic_bp: 90,
        medication_taken: false,
        symptoms: [],
        missed_medications: [
          { drug_name: 'Lisinopril', reason: 'forgot' },
          { drug_name: 'Atorvastatin', reason: 'COST', missed_doses: 2 },
        ],
      },
      ctx as any,
      USER,
    )
    const dto = ctx.journalService.create.mock.calls[0][1] as Record<string, unknown>
    expect(dto.missedMedications).toEqual([
      { drugName: 'Lisinopril', reason: 'FORGOT', missedDoses: 1 },
      { drugName: 'Atorvastatin', reason: 'COST', missedDoses: 2 },
    ])
  })

  it('threads measurement_conditions (B1 checklist) — only known booleans', async () => {
    const ctx = makeCtx()
    await executeJournalTool(
      'submit_checkin',
      {
        entry_date: '2026-05-20',
        measurement_time: '08:30',
        systolic_bp: 120,
        diastolic_bp: 80,
        medication_taken: true,
        symptoms: [],
        measurement_conditions: { noCaffeine: true, cuffOnBareArm: true, junkKey: 'oops' },
      },
      ctx as any,
      USER,
    )
    const dto = ctx.journalService.create.mock.calls[0][1] as Record<string, unknown>
    expect(dto.measurementConditions).toEqual({ noCaffeine: true, cuffOnBareArm: true })
  })

  it('resolves "today" / "now" via the literal-string fallbacks', async () => {
    const ctx = makeCtx()
    await executeJournalTool(
      'submit_checkin',
      {
        entry_date: 'today',
        measurement_time: 'now',
        systolic_bp: 120,
        diastolic_bp: 80,
        medication_taken: true,
        symptoms: [],
      },
      ctx as any,
      USER,
    )
    const dto = ctx.journalService.create.mock.calls[0][1] as Record<string, unknown>
    expect(typeof dto.measuredAt).toBe('string')
    expect(dto.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  })

  it('returns saved:false with message when DailyJournalService throws', async () => {
    const ctx = makeCtx()
    ;(ctx.journalService.create as jest.Mock<any>).mockRejectedValueOnce(
      new Error('DB down'),
    )
    const result = await executeJournalTool(
      'submit_checkin',
      {
        entry_date: '2026-05-20',
        measurement_time: '08:30',
        systolic_bp: 120,
        diastolic_bp: 80,
        medication_taken: true,
        symptoms: [],
      },
      ctx as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.saved).toBe(false)
    expect(parsed.message).toContain('DB down')
  })
})

// ─── get_recent_readings ──────────────────────────────────────────────────────

describe('get_recent_readings scenarios', () => {
  it('returns count + reading list when entries exist', async () => {
    // Bug 26 — measurement_time must be projected into the patient's
    // local timezone, not echoed as the raw UTC wallclock slice. ctx
    // has no timezone here, so the dispatcher falls back to
    // 'America/New_York'. May 19 2026 is EDT (UTC-4) → stored 08:30Z
    // projects to 04:30 local. Pre-fix this returned '08:30' (UTC), so
    // a New York patient asking "how am I doing?" saw chatbot times
    // four hours later than the My Readings UI.
    const ctx = makeCtx()
    ;(ctx.journalService.findAll as jest.Mock<any>).mockResolvedValueOnce({
      data: [
        {
          id: 'e1',
          measuredAt: '2026-05-19T08:30:00.000Z',
          systolicBP: 132,
          diastolicBP: 84,
          medicationTaken: true,
          otherSymptoms: [],
        },
      ],
    })
    const result = await executeJournalTool(
      'get_recent_readings',
      { days: 7 },
      ctx as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.count).toBe(1)
    expect(parsed.readings[0].systolic).toBe(132)
    expect(parsed.readings[0].date).toBe('2026-05-19')
    expect(parsed.readings[0].measurement_time).toBe('04:30')
  })

  it('Bug 26 — projects measuredAt into ctx.timezone when explicitly provided', async () => {
    // Same UTC instant, different ctx tz. IST = UTC+5:30, no DST →
    // 08:30Z projects to 14:00 IST. Confirms ctx.timezone is the
    // override path, not just the default.
    const ctx = { ...makeCtx(), timezone: 'Asia/Kolkata' }
    ;(ctx.journalService.findAll as jest.Mock<any>).mockResolvedValueOnce({
      data: [
        {
          id: 'e1',
          measuredAt: '2026-05-19T08:30:00.000Z',
          systolicBP: 132,
          diastolicBP: 84,
          medicationTaken: true,
          otherSymptoms: [],
        },
      ],
    })
    const result = await executeJournalTool(
      'get_recent_readings',
      { days: 7 },
      ctx as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.readings[0].date).toBe('2026-05-19')
    expect(parsed.readings[0].measurement_time).toBe('14:00')
  })

  it('returns empty when no entries exist', async () => {
    const ctx = makeCtx()
    const result = await executeJournalTool(
      'get_recent_readings',
      { days: 7 },
      ctx as any,
      USER,
    )
    expect(JSON.parse(result)).toEqual({ readings: [], count: 0 })
  })

  it('defaults to 7 days when days arg is missing/zero', async () => {
    const ctx = makeCtx()
    await executeJournalTool('get_recent_readings', {}, ctx as any, USER)
    expect(ctx.journalService.findAll).toHaveBeenCalled()
  })
})

// ─── update_checkin ───────────────────────────────────────────────────────────

describe('update_checkin scenarios', () => {
  it('finds entry by date+time and applies field changes', async () => {
    const ctx = makeCtx()
    ;(ctx.journalService.findAll as jest.Mock<any>).mockResolvedValueOnce({
      data: [{ id: 'e1', measuredAt: '2026-05-20T08:30:00.000Z' }],
    })
    const result = await executeJournalTool(
      'update_checkin',
      { entry_date: '2026-05-20', original_time: '08:30', systolic_bp: 125 },
      ctx as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.updated).toBe(true)
    expect(ctx.journalService.update).toHaveBeenCalledWith(
      USER,
      'e1',
      expect.objectContaining({ systolicBP: 125 }),
    )
  })

  it('refuses when no entry matches the date+time', async () => {
    const ctx = makeCtx()
    ;(ctx.journalService.findAll as jest.Mock<any>).mockResolvedValueOnce({ data: [] })
    const result = await executeJournalTool(
      'update_checkin',
      { entry_date: '2026-05-20', original_time: '08:30', systolic_bp: 125 },
      ctx as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.updated).toBe(false)
    expect(parsed.message.toLowerCase()).toContain('could not find')
    expect(ctx.journalService.update).not.toHaveBeenCalled()
  })

  it('refuses when no fields are changing (no-op guard)', async () => {
    const ctx = makeCtx()
    const result = await executeJournalTool(
      'update_checkin',
      { entry_id: 'e1' },
      ctx as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.updated).toBe(false)
    expect(parsed.message.toLowerCase()).toContain('no fields')
  })

  it('threads structured Stage A booleans into the update DTO', async () => {
    const ctx = makeCtx()
    ;(ctx.journalService.findAll as jest.Mock<any>).mockResolvedValueOnce({
      data: [{ id: 'e1', measuredAt: '2026-05-20T08:30:00.000Z' }],
    })
    await executeJournalTool(
      'update_checkin',
      {
        entry_date: '2026-05-20',
        original_time: '08:30',
        severe_headache: true,
        chest_pain_or_dyspnea: false,
      },
      ctx as any,
      USER,
    )
    const dto = ctx.journalService.update.mock.calls[0][2] as Record<string, unknown>
    expect(dto.severeHeadache).toBe(true)
    expect(dto.chestPainOrDyspnea).toBe(false)
  })
})

// ─── delete_checkin ───────────────────────────────────────────────────────────

describe('delete_checkin scenarios', () => {
  it('finds entry by date+time and deletes', async () => {
    const ctx = makeCtx()
    ;(ctx.journalService.findAll as jest.Mock<any>).mockResolvedValueOnce({
      data: [{ id: 'e1', measuredAt: '2026-05-20T08:30:00.000Z' }],
    })
    const result = await executeJournalTool(
      'delete_checkin',
      { entry_date: '2026-05-20', original_time: '08:30' },
      ctx as any,
      USER,
    )
    expect(JSON.parse(result).deleted).toBe(true)
    expect(ctx.journalService.delete).toHaveBeenCalledWith(USER, 'e1')
  })

  it('returns deleted:false with message when entry not found', async () => {
    const ctx = makeCtx()
    ;(ctx.journalService.findAll as jest.Mock<any>).mockResolvedValueOnce({ data: [] })
    const result = await executeJournalTool(
      'delete_checkin',
      { entry_date: '2026-05-20', original_time: '08:30' },
      ctx as any,
      USER,
    )
    expect(JSON.parse(result).deleted).toBe(false)
    expect(ctx.journalService.delete).not.toHaveBeenCalled()
  })
})

// ─── log_medication_adherence (Phase/27) ──────────────────────────────────────

describe('log_medication_adherence scenarios', () => {
  it('logs "I took my Lisinopril this morning"', async () => {
    const ctx = makeCtx()
    const result = await executeJournalTool(
      'log_medication_adherence',
      { drug_name: 'Lisinopril', status: 'taken' },
      ctx as any,
      USER,
    )
    expect(JSON.parse(result).logged).toBe(true)
    expect(ctx.adherenceService.log).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ drugName: 'Lisinopril', status: 'taken' }),
    )
  })

  it('logs "I missed my Atorvastatin yesterday"', async () => {
    const ctx = makeCtx()
    await executeJournalTool(
      'log_medication_adherence',
      { drug_name: 'Atorvastatin', status: 'missed', missed_doses: 1, reason: 'FORGOT' },
      ctx as any,
      USER,
    )
    expect(ctx.adherenceService.log).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({
        drugName: 'Atorvastatin',
        status: 'missed',
        missedDoses: 1,
        reason: 'FORGOT',
      }),
    )
  })

  it('logs "Skip my Carvedilol, I will take it later"', async () => {
    const ctx = makeCtx()
    await executeJournalTool(
      'log_medication_adherence',
      { drug_name: 'Carvedilol', status: 'scheduled_later' },
      ctx as any,
      USER,
    )
    expect(ctx.adherenceService.log).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ drugName: 'Carvedilol', status: 'scheduled_later' }),
    )
  })

  it('rejects an unknown status string', async () => {
    const ctx = makeCtx()
    const result = await executeJournalTool(
      'log_medication_adherence',
      { drug_name: 'X', status: 'half-taken' },
      ctx as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.logged).toBe(false)
    expect(ctx.adherenceService.log).not.toHaveBeenCalled()
  })

  it('returns clear failure when adherenceService is not wired in ctx (legacy path)', async () => {
    const result = await executeJournalTool(
      'log_medication_adherence',
      { drug_name: 'X', status: 'taken' },
      { create: jest.fn(), findAll: jest.fn(), update: jest.fn(), delete: jest.fn() } as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.logged).toBe(false)
    expect(parsed.message.toLowerCase()).toContain('not available')
  })
})

// ─── log_symptom_quick (Phase/27) ─────────────────────────────────────────────

describe('log_symptom_quick scenarios', () => {
  it('logs a Stage-A symptom ("severe headache right now")', async () => {
    const ctx = makeCtx()
    const result = await executeJournalTool(
      'log_symptom_quick',
      { symptom: 'severeHeadache', notes: 'throbbing behind my eyes' },
      ctx as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.logged).toBe(true)
    expect(ctx.symptomService.log).toHaveBeenCalledWith(USER, {
      symptom: 'severeHeadache',
      notes: 'throbbing behind my eyes',
    })
  })

  it('logs a Cluster 7 side-effect symptom (dryCough)', async () => {
    const ctx = makeCtx()
    await executeJournalTool(
      'log_symptom_quick',
      { symptom: 'dryCough' },
      ctx as any,
      USER,
    )
    expect(ctx.symptomService.log).toHaveBeenCalledWith(USER, {
      symptom: 'dryCough',
      notes: undefined,
    })
  })

  it('logs a Cluster 8 airway-emergency symptom (faceSwelling, P0)', async () => {
    const ctx = makeCtx()
    await executeJournalTool(
      'log_symptom_quick',
      { symptom: 'faceSwelling' },
      ctx as any,
      USER,
    )
    expect(ctx.symptomService.log).toHaveBeenCalledWith(USER, {
      symptom: 'faceSwelling',
      notes: undefined,
    })
  })

  it('rejects an invalid symptom key', async () => {
    const ctx = makeCtx()
    const result = await executeJournalTool(
      'log_symptom_quick',
      { symptom: 'spaceSickness' },
      ctx as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.logged).toBe(false)
    expect(ctx.symptomService.log).not.toHaveBeenCalled()
  })

  it('returns clear failure when symptomService is not wired (legacy path)', async () => {
    const result = await executeJournalTool(
      'log_symptom_quick',
      { symptom: 'severeHeadache' },
      { create: jest.fn(), findAll: jest.fn(), update: jest.fn(), delete: jest.fn() } as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.logged).toBe(false)
    expect(parsed.message.toLowerCase()).toContain('not available')
  })
})

// ─── submit_bp_from_photo (Phase/27) ──────────────────────────────────────────

describe('submit_bp_from_photo scenarios', () => {
  it('parses a high-confidence reading and returns numbers for verbal confirm', async () => {
    const ctx = makeCtx()
    const result = await executeJournalTool(
      'submit_bp_from_photo',
      { image_base64: Buffer.from('x').toString('base64'), mime_type: 'image/jpeg' },
      ctx as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.parsed).toBe(true)
    expect(parsed.sbp).toBe(138)
    expect(parsed.dbp).toBe(84)
    expect(parsed.confidence).toBe(0.92)
    expect(parsed.message.toLowerCase()).toContain('confirm with the patient')
  })

  it('rejects when image_base64 is empty', async () => {
    const ctx = makeCtx()
    const result = await executeJournalTool(
      'submit_bp_from_photo',
      { image_base64: '', mime_type: 'image/jpeg' },
      ctx as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.parsed).toBe(false)
    expect(ctx.ocrService.extractBp).not.toHaveBeenCalled()
  })

  it('returns clear failure when ocrService is not wired (legacy path)', async () => {
    const result = await executeJournalTool(
      'submit_bp_from_photo',
      { image_base64: 'aGk=', mime_type: 'image/jpeg' },
      { create: jest.fn(), findAll: jest.fn(), update: jest.fn(), delete: jest.fn() } as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.parsed).toBe(false)
    expect(parsed.message.toLowerCase()).toContain('not enabled')
  })
})

// ─── flag_emergency ───────────────────────────────────────────────────────────

describe('flag_emergency scenarios', () => {
  it('flags the situation and returns 911-guidance message', async () => {
    const ctx = makeCtx()
    const result = await executeJournalTool(
      'flag_emergency',
      { emergency_situation: 'crushing chest pain now' },
      ctx as any,
      USER,
    )
    const parsed = JSON.parse(result)
    expect(parsed.flagged).toBe(true)
    expect(parsed.emergency_situation).toBe('crushing chest pain now')
    expect(parsed.message.toLowerCase()).toContain('911')
  })

  it('falls back to a default situation string when arg is missing', async () => {
    const ctx = makeCtx()
    const result = await executeJournalTool(
      'flag_emergency',
      {},
      ctx as any,
      USER,
    )
    expect(JSON.parse(result).flagged).toBe(true)
  })
})
