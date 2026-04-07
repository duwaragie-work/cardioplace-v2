/**
 * Gemini function-calling tool definitions for journal entry CRUD.
 * These call DailyJournalService directly (in-process, no HTTP round-trip).
 */

import { Type } from '@google/genai'
import type { FunctionDeclaration } from '@google/genai'
import { DailyJournalService } from '../../daily_journal/daily_journal.service.js'

/**
 * Normalise a time string to HH:mm 24-hour format.
 * Handles: "13:00", "1:00 PM", "8:30 am", "2 PM", "14:15", etc.
 * Returns undefined if the input can't be parsed.
 */
export function normaliseTime(raw?: string): string | undefined {
  if (!raw) return undefined
  const s = raw.trim()

  // Already HH:mm
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return s

  // Try "H:mm AM/PM" or "HH:mm AM/PM"
  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i)
  if (ampm) {
    let h = parseInt(ampm[1], 10)
    const m = ampm[2]
    const period = ampm[3].toLowerCase()
    if (period === 'pm' && h < 12) h += 12
    if (period === 'am' && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:${m}`
  }

  // Try "H AM/PM" or "HH AM/PM" (no minutes)
  const ampmNoMin = s.match(/^(\d{1,2})\s*(am|pm)$/i)
  if (ampmNoMin) {
    let h = parseInt(ampmNoMin[1], 10)
    const period = ampmNoMin[2].toLowerCase()
    if (period === 'pm' && h < 12) h += 12
    if (period === 'am' && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:00`
  }

  // Try bare "H:mm" (e.g. "9:30") — assume 24h if <=23
  const bare = s.match(/^(\d{1,2}):(\d{2})$/)
  if (bare) {
    const h = parseInt(bare[1], 10)
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:${bare[2]}`
  }

  return undefined
}

// ── Gemini FunctionDeclaration definitions ──────────────────────────────────

export function getJournalToolDeclarations(): FunctionDeclaration[] {
  return [
    {
      name: 'submit_checkin',
      description:
        'Submit a new blood pressure check-in for the patient. ' +
        'Use this after confirming all values with the patient.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          entry_date: { type: Type.STRING, description: 'Date in YYYY-MM-DD format. Use today if not specified.' },
          measurement_time: { type: Type.STRING, description: 'Time the reading was taken in HH:mm 24-hour format (e.g. "08:30", "14:15"). Omit to use current time.' },
          systolic_bp: { type: Type.NUMBER, description: 'Systolic BP — the top number (60–250).' },
          diastolic_bp: { type: Type.NUMBER, description: 'Diastolic BP — the bottom number (40–150).' },
          medication_taken: { type: Type.BOOLEAN, description: 'Whether the patient took their medications.' },
          weight: { type: Type.NUMBER, description: 'Weight in lbs. Omit if not provided.' },
          symptoms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'List of symptoms reported. ALWAYS in English regardless of conversation language.' },
          notes: { type: Type.STRING, description: 'Any extra notes. ALWAYS in English regardless of conversation language.' },
        },
        required: ['entry_date', 'systolic_bp', 'diastolic_bp', 'medication_taken'],
      },
    },
    {
      name: 'get_recent_readings',
      description:
        "Retrieve the patient's recent blood pressure readings. " +
        'Use when the patient asks about past readings, trends, or before updating/deleting.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          days: { type: Type.NUMBER, description: 'Number of days to look back (1–30). Use 7 if not specified.' },
        },
        required: ['days'],
      },
    },
    {
      name: 'update_checkin',
      description:
        'Update an existing blood pressure reading. ' +
        'You MUST first call get_recent_readings to find the entry ID. ' +
        'Only include fields that need to change.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          entry_id: { type: Type.STRING, description: 'The ID of the journal entry to update (from get_recent_readings).' },
          measurement_time: { type: Type.STRING, description: 'New measurement time in HH:mm 24-hour format (e.g. "08:30", "14:15").' },
          systolic_bp: { type: Type.NUMBER, description: 'New systolic BP (60–250).' },
          diastolic_bp: { type: Type.NUMBER, description: 'New diastolic BP (40–150).' },
          medication_taken: { type: Type.BOOLEAN, description: 'New medication status.' },
          weight: { type: Type.NUMBER, description: 'New weight in lbs.' },
          symptoms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'New symptom list. ALWAYS in English regardless of conversation language.' },
          notes: { type: Type.STRING, description: 'New notes. ALWAYS in English regardless of conversation language.' },
        },
        required: ['entry_id'],
      },
    },
    {
      name: 'delete_checkin',
      description:
        'Delete a blood pressure reading. ' +
        'You MUST first call get_recent_readings to find the entry ID, ' +
        'confirm the date and values with the patient, and get explicit confirmation before deleting.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          entry_id: { type: Type.STRING, description: 'The ID of the journal entry to delete (from get_recent_readings).' },
        },
        required: ['entry_id'],
      },
    },
    {
      name: 'flag_emergency',
      description:
        'Flag a life-threatening emergency happening RIGHT NOW. ' +
        'Call this ONLY when the patient describes an acute emergency in the present tense: ' +
        'crushing chest pain NOW, sudden inability to breathe NOW, sudden numbness/weakness on one side NOW, ' +
        'sudden loss of vision NOW, feeling like a heart attack or stroke RIGHT NOW, or active suicidal ideation NOW. ' +
        'Do NOT call for: past tense symptoms, routine symptom reporting during check-in, high BP numbers, ' +
        'occasional/mild symptoms (dizziness, headache), or health questions.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          emergency_situation: { type: Type.STRING, description: 'Brief description of the emergency detected.' },
        },
        required: ['emergency_situation'],
      },
    },
  ]
}

// ── Tool executor ───────────────────────────────────────────────────────────

export async function executeJournalTool(
  name: string,
  args: Record<string, any>,
  journalService: DailyJournalService,
  userId: string,
): Promise<string> {
  switch (name) {
    case 'submit_checkin': {
      try {
        const result = await journalService.create(userId, {
          entryDate: args.entry_date,
          measurementTime: normaliseTime(args.measurement_time),
          systolicBP: args.systolic_bp,
          diastolicBP: args.diastolic_bp,
          medicationTaken: args.medication_taken,
          weight: args.weight,
          symptoms: args.symptoms ?? [],
          notes: args.notes ?? '',
        } as any)
        return JSON.stringify({ saved: true, message: 'Check-in saved successfully.', data: result.data })
      } catch (err: any) {
        return JSON.stringify({ saved: false, message: err.message ?? 'Failed to save check-in.' })
      }
    }

    case 'get_recent_readings': {
      try {
        const days = args.days && args.days > 0 ? args.days : 7
        const startDate = new Date()
        startDate.setDate(startDate.getDate() - days)
        // Use tomorrow as end boundary to include entries from users ahead of UTC
        const endDate = new Date()
        endDate.setDate(endDate.getDate() + 1)
        const result = await journalService.findAll(
          userId,
          startDate.toISOString().slice(0, 10),
          endDate.toISOString().slice(0, 10),
          15,
        )
        const entries = (result.data ?? []).map((e: any) => ({
          id: e.id,
          date: e.entryDate,
          measurement_time: e.measurementTime ?? null,
          systolic: e.systolicBP,
          diastolic: e.diastolicBP,
          weight: e.weight,
          medication_taken: e.medicationTaken,
          symptoms: e.symptoms ?? [],
        }))
        return JSON.stringify({ readings: entries, count: entries.length })
      } catch (err: any) {
        return JSON.stringify({ readings: [], count: 0, error: err.message })
      }
    }

    case 'update_checkin': {
      try {
        const dto: any = {}
        if (args.measurement_time != null) dto.measurementTime = normaliseTime(args.measurement_time)
        if (args.systolic_bp != null) dto.systolicBP = args.systolic_bp
        if (args.diastolic_bp != null) dto.diastolicBP = args.diastolic_bp
        if (args.medication_taken != null) dto.medicationTaken = args.medication_taken
        if (args.weight != null) dto.weight = args.weight
        if (args.symptoms != null) dto.symptoms = args.symptoms
        if (args.notes != null) dto.notes = args.notes

        if (Object.keys(dto).length === 0) {
          return JSON.stringify({ updated: false, message: 'No fields to update.' })
        }

        const result = await journalService.update(userId, args.entry_id, dto)
        return JSON.stringify({ updated: true, message: 'Reading updated successfully.', data: result.data })
      } catch (err: any) {
        return JSON.stringify({ updated: false, message: err.message ?? 'Failed to update.' })
      }
    }

    case 'delete_checkin': {
      try {
        await journalService.delete(userId, args.entry_id)
        return JSON.stringify({ deleted: true, message: 'Reading deleted successfully.' })
      } catch (err: any) {
        return JSON.stringify({ deleted: false, message: err.message ?? 'Failed to delete.' })
      }
    }

    case 'flag_emergency': {
      return JSON.stringify({
        flagged: true,
        emergency_situation: args.emergency_situation ?? 'Emergency detected',
        message: 'Emergency flagged. Continue responding to the patient with 911 guidance.',
      })
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}
