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
        'Submit a new blood pressure check-in. ' +
        'BEFORE calling this tool you MUST have asked the patient AND received their answer for ALL of these: ' +
        '1) BP numbers (systolic and diastolic), ' +
        '2) Did they take their medication? (must be a real yes/no from the patient), ' +
        '3) Any symptoms? (must be a real answer from the patient — even "none" counts), ' +
        '4) Their weight (they can skip). ' +
        'If ANY of these have not been explicitly answered by the patient in the conversation, ' +
        'DO NOT call this tool — ask the missing question first. ' +
        'After collecting everything, you must summarise and get the patient to confirm before calling.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          entry_date: { type: Type.STRING, description: 'Date in YYYY-MM-DD format.' },
          measurement_time: { type: Type.STRING, description: 'Time in HH:mm 24-hour format (e.g. "08:30", "14:15").' },
          systolic_bp: { type: Type.NUMBER, description: 'Systolic (top number, 60–250). Must come from the patient.' },
          diastolic_bp: { type: Type.NUMBER, description: 'Diastolic (bottom number, 40–150). Must come from the patient.' },
          medication_taken: { type: Type.BOOLEAN, description: 'Did the patient take their meds? Must be explicitly answered by the patient.' },
          weight: { type: Type.NUMBER, description: 'Weight in lbs. Omit if skipped.' },
          symptoms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Symptoms list in English. Empty array [] if patient said none.' },
          notes: { type: Type.STRING, description: 'Extra notes in English. Omit if none.' },
        },
        required: ['entry_date', 'measurement_time', 'systolic_bp', 'diastolic_bp', 'medication_taken', 'symptoms'],
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
        'Identify the reading by its date and time. Only include fields that need to change.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          entry_date: { type: Type.STRING, description: 'Date of the reading to update (YYYY-MM-DD).' },
          original_time: { type: Type.STRING, description: 'The measurement time of the reading to update (HH:mm 24-hour format, e.g. "00:30", "12:10").' },
          entry_id: { type: Type.STRING, description: 'Entry ID from get_recent_readings (optional, used if available).' },
          measurement_time: { type: Type.STRING, description: 'New measurement time in HH:mm 24-hour format.' },
          systolic_bp: { type: Type.NUMBER, description: 'New systolic (top number) BP (60–250).' },
          diastolic_bp: { type: Type.NUMBER, description: 'New diastolic (bottom number) BP (40–150).' },
          medication_taken: { type: Type.BOOLEAN, description: 'New medication status.' },
          weight: { type: Type.NUMBER, description: 'New weight in lbs.' },
          symptoms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'New symptom list. ALWAYS in English regardless of conversation language.' },
          notes: { type: Type.STRING, description: 'New notes. ALWAYS in English regardless of conversation language.' },
        },
        required: ['entry_date', 'original_time'],
      },
    },
    {
      name: 'delete_checkin',
      description:
        'Delete a blood pressure reading. ' +
        'Identify the reading by its date and time. ' +
        'Confirm the values with the patient and get explicit confirmation before deleting.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          entry_date: { type: Type.STRING, description: 'Date of the reading to delete (YYYY-MM-DD).' },
          original_time: { type: Type.STRING, description: 'The measurement time of the reading to delete (HH:mm 24-hour format).' },
          entry_id: { type: Type.STRING, description: 'Entry ID from get_recent_readings (optional, used if available).' },
        },
        required: ['entry_date', 'original_time'],
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
      // Guard: reject if required fields are missing or have placeholder values.
      // This prevents the model from saving before asking all required questions.
      const missing: string[] = []
      if (args.systolic_bp == null || args.diastolic_bp == null) {
        missing.push('blood pressure (ask for the top number and bottom number)')
      }
      if (args.medication_taken == null) {
        missing.push('medication_taken (ask: "Did you take your medication today?")')
      }
      if (!Array.isArray(args.symptoms)) {
        missing.push('symptoms (ask: "Any symptoms like headache, dizziness, chest tightness, or shortness of breath?")')
      }
      if (missing.length > 0) {
        console.log(`[submit_checkin REJECTED] Missing fields: ${missing.join(', ')}`)
        return JSON.stringify({
          saved: false,
          _internal: true,
          next_action: `Ask about: ${missing[0]}`,
        })
      }
      // Block future dates
      const entryDate = args.entry_date || new Date().toISOString().slice(0, 10)
      const today = new Date().toISOString().slice(0, 10)
      if (entryDate > today) {
        return JSON.stringify({
          saved: false,
          message: `Cannot save a check-in for a future date (${entryDate}). Check-ins can only be recorded for today or past dates. Please use today's date.`,
        })
      }
      try {
        const time = normaliseTime(args.measurement_time) ?? new Date().toISOString().slice(11, 16)
        const measuredAt = new Date(`${entryDate}T${time}:00.000Z`).toISOString()
        const result = await journalService.create(userId, {
          measuredAt,
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
        const entries = (result.data ?? []).map((e: any) => {
          const d = new Date(e.measuredAt)
          return {
            id: e.id,
            date: d.toISOString().slice(0, 10),
            measurement_time: d.toISOString().slice(11, 16),
            systolic: e.systolicBP,
            diastolic: e.diastolicBP,
            weight: e.weight,
            medication_taken: e.medicationTaken,
            symptoms: e.otherSymptoms ?? [],
          }
        })
        return JSON.stringify({ readings: entries, count: entries.length })
      } catch (err: any) {
        return JSON.stringify({ readings: [], count: 0, error: err.message })
      }
    }

    case 'update_checkin': {
      try {
        const dto: any = {}
        if (args.entry_date != null || args.measurement_time != null) {
          const d = args.entry_date || new Date().toISOString().slice(0, 10)
          const t =
            normaliseTime(args.measurement_time) ??
            new Date().toISOString().slice(11, 16)
          dto.measuredAt = new Date(`${d}T${t}:00.000Z`).toISOString()
        }
        if (args.systolic_bp != null) dto.systolicBP = args.systolic_bp
        if (args.diastolic_bp != null) dto.diastolicBP = args.diastolic_bp
        if (args.medication_taken != null) dto.medicationTaken = args.medication_taken
        if (args.weight != null) dto.weight = args.weight
        if (args.symptoms != null) dto.symptoms = args.symptoms
        if (args.notes != null) dto.notes = args.notes

        if (Object.keys(dto).length === 0) {
          return JSON.stringify({ updated: false, message: 'No fields to update.' })
        }

        const origTime = normaliseTime(args.original_time)
        const argDate = args.entry_date
        let entryId = args.entry_id

        if (argDate || origTime) {
          const startDate = new Date()
          startDate.setDate(startDate.getDate() - 30)
          const endDate = new Date()
          endDate.setDate(endDate.getDate() + 2)
          const recent = await journalService.findAll(userId, startDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10), 50)
          const entries = recent.data ?? []

          const match = entries.find((e: any) => {
            const d = new Date(e.measuredAt)
            const entryDateStr = d.toISOString().slice(0, 10)
            const entryTimeStr = d.toISOString().slice(11, 16)
            const dateMatch = !argDate || entryDateStr === argDate
            const timeMatch = !origTime || entryTimeStr === origTime
            return dateMatch && timeMatch
          })

          if (match) {
            console.log(`[update_checkin] Found entry by date/time: ${match.id}`)
            entryId = match.id
          }
        }

        if (!entryId) {
          return JSON.stringify({ updated: false, message: 'Could not find the reading. Please specify the date and time.' })
        }

        const result = await journalService.update(userId, entryId, dto)
        return JSON.stringify({ updated: true, message: 'Reading updated successfully.', data: result.data })
      } catch (err: any) {
        return JSON.stringify({ updated: false, message: err.message ?? 'Failed to update.' })
      }
    }

    case 'delete_checkin': {
      try {
        const origTime = normaliseTime(args.original_time)
        const argDate = args.entry_date
        let entryId = args.entry_id

        console.log(`[delete_checkin] Args: date=${argDate}, time=${args.original_time}, normalised=${origTime}, id=${entryId}`)

        // Find by date + time first
        if (argDate || origTime) {
          const startDate = new Date()
          startDate.setDate(startDate.getDate() - 30)
          const endDate = new Date()
          endDate.setDate(endDate.getDate() + 2)
          const recent = await journalService.findAll(userId, startDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10), 50)
          const entries = recent.data ?? []

          console.log(`[delete_checkin] Found ${entries.length} entries, looking for date=${argDate} time=${origTime}`)
          for (const e of entries) {
            const d = new Date(e.measuredAt)
            console.log(`  entry: date=${d.toISOString().slice(0, 10)} time=${d.toISOString().slice(11, 16)} id=${e.id}`)
          }

          const match = entries.find((e: any) => {
            const d = new Date(e.measuredAt)
            const entryDateStr = d.toISOString().slice(0, 10)
            const entryTimeStr = d.toISOString().slice(11, 16)
            const dateMatch = !argDate || entryDateStr === argDate
            const timeMatch = !origTime || entryTimeStr === origTime
            return dateMatch && timeMatch
          })

          if (match) {
            console.log(`[delete_checkin] Found entry by date/time: ${match.id}`)
            entryId = match.id
          } else {
            console.log(`[delete_checkin] No match found for date=${argDate} time=${origTime}`)
          }
        }

        if (!entryId) {
          return JSON.stringify({ deleted: false, message: 'Could not find the reading. Please specify the date and time.' })
        }

        await journalService.delete(userId, entryId)
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
