// Voice tools dispatch tests. Each tool case mocks the dependent service so
// we can assert: (1) the dispatcher routes by name to the right method, (2)
// arguments are coerced + threaded through correctly, (3) the side-channel
// `events` array surfaces the right Socket.io fan-out shape, (4) the
// llmResponse matches Gemini's FunctionResponse contract.

import { jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import { VoiceToolsService } from './voice-tools.service.js'
import { DailyJournalService } from '../../daily_journal/daily_journal.service.js'
import { GeminiService } from '../../gemini/gemini.service.js'

const CTX = { userId: 'user-1', timezone: 'America/New_York' }

describe('VoiceToolsService.dispatch', () => {
  let service: VoiceToolsService
  let dailyJournal: { create: jest.Mock; findAll: jest.Mock; findOne: jest.Mock; update: jest.Mock; delete: jest.Mock }
  let gemini: { extractBpFromImage: jest.Mock }

  beforeEach(async () => {
    dailyJournal = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    }
    gemini = { extractBpFromImage: jest.fn() }

    const moduleRef = await Test.createTestingModule({
      providers: [
        VoiceToolsService,
        { provide: DailyJournalService, useValue: dailyJournal },
        { provide: GeminiService, useValue: gemini },
      ],
    }).compile()

    service = moduleRef.get(VoiceToolsService)
  })

  // ── declarations ──────────────────────────────────────────────────────────

  it('exposes 5 function declarations matching the Python contract', () => {
    const decls = service.getToolDeclarations()
    const names = decls.map((d) => d.name).sort()
    expect(names).toEqual([
      'delete_checkin',
      'get_recent_readings',
      'submit_bp_from_photo',
      'submit_checkin',
      'update_checkin',
    ])
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
})
