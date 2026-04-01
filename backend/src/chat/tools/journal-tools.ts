/**
 * LangChain tool definitions for journal entry CRUD.
 * These call DailyJournalService directly (in-process, no HTTP round-trip).
 */

import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { DailyJournalService } from '../../daily_journal/daily_journal.service.js'

export function createJournalTools(
  journalService: DailyJournalService,
  userId: string,
): DynamicStructuredTool[] {
  const submitCheckin = new DynamicStructuredTool({
    name: 'submit_checkin',
    description:
      'Submit a new blood pressure check-in for the patient. ' +
      'Use this after confirming all values with the patient.',
    schema: z.object({
      entry_date: z.string().describe('Date in YYYY-MM-DD format. Use today if not specified.'),
      systolic_bp: z.number().min(60).max(250).describe('Systolic BP — the top number.'),
      diastolic_bp: z.number().min(40).max(150).describe('Diastolic BP — the bottom number.'),
      medication_taken: z.boolean().describe('Whether the patient took their medications.'),
      weight: z.number().optional().describe('Weight in lbs. Omit if not provided.'),
      symptoms: z.array(z.string()).optional().describe('List of symptoms reported. ALWAYS in English regardless of conversation language.'),
      notes: z.string().optional().describe('Any extra notes. ALWAYS in English regardless of conversation language.'),
    }),
    func: async (input) => {
      try {
        const result = await journalService.create(userId, {
          entryDate: input.entry_date,
          systolicBP: input.systolic_bp,
          diastolicBP: input.diastolic_bp,
          medicationTaken: input.medication_taken,
          weight: input.weight,
          symptoms: input.symptoms ?? [],
          notes: input.notes ?? '',
        } as any)
        return JSON.stringify({
          saved: true,
          message: 'Check-in saved successfully.',
          data: result.data,
        })
      } catch (err: any) {
        return JSON.stringify({
          saved: false,
          message: err.message ?? 'Failed to save check-in.',
        })
      }
    },
  })

  const getRecentReadings = new DynamicStructuredTool({
    name: 'get_recent_readings',
    description:
      'Retrieve the patient\'s recent blood pressure readings. ' +
      'Use when the patient asks about past readings, trends, or before updating/deleting.',
    schema: z.object({
      days: z.number().min(1).max(30).optional().default(7).describe('Number of days to look back (default 7).'),
    }),
    func: async (input) => {
      try {
        const startDate = new Date()
        startDate.setDate(startDate.getDate() - (input.days ?? 7))
        const result = await journalService.findAll(
          userId,
          startDate.toISOString().slice(0, 10),
          undefined,
          15,
        )
        const entries = (result.data ?? []).map((e: any) => ({
          id: e.id,
          date: e.entryDate,
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
    },
  })

  const updateCheckin = new DynamicStructuredTool({
    name: 'update_checkin',
    description:
      'Update an existing blood pressure reading. ' +
      'You MUST first call get_recent_readings to find the entry ID. ' +
      'Only include fields that need to change.',
    schema: z.object({
      entry_id: z.string().describe('The ID of the journal entry to update (from get_recent_readings).'),
      systolic_bp: z.number().min(60).max(250).optional().describe('New systolic BP.'),
      diastolic_bp: z.number().min(40).max(150).optional().describe('New diastolic BP.'),
      medication_taken: z.boolean().optional().describe('New medication status.'),
      weight: z.number().optional().describe('New weight in lbs.'),
      symptoms: z.array(z.string()).optional().describe('New symptom list. ALWAYS in English regardless of conversation language.'),
      notes: z.string().optional().describe('New notes. ALWAYS in English regardless of conversation language.'),
    }),
    func: async (input) => {
      try {
        const dto: any = {}
        if (input.systolic_bp != null) dto.systolicBP = input.systolic_bp
        if (input.diastolic_bp != null) dto.diastolicBP = input.diastolic_bp
        if (input.medication_taken != null) dto.medicationTaken = input.medication_taken
        if (input.weight != null) dto.weight = input.weight
        if (input.symptoms != null) dto.symptoms = input.symptoms
        if (input.notes != null) dto.notes = input.notes

        if (Object.keys(dto).length === 0) {
          return JSON.stringify({ updated: false, message: 'No fields to update.' })
        }

        const result = await journalService.update(userId, input.entry_id, dto)
        return JSON.stringify({ updated: true, message: 'Reading updated successfully.', data: result.data })
      } catch (err: any) {
        return JSON.stringify({ updated: false, message: err.message ?? 'Failed to update.' })
      }
    },
  })

  const deleteCheckin = new DynamicStructuredTool({
    name: 'delete_checkin',
    description:
      'Delete a blood pressure reading. ' +
      'You MUST first call get_recent_readings to find the entry ID, ' +
      'confirm the date and values with the patient, and get explicit confirmation before deleting.',
    schema: z.object({
      entry_id: z.string().describe('The ID of the journal entry to delete (from get_recent_readings).'),
    }),
    func: async (input) => {
      try {
        await journalService.delete(userId, input.entry_id)
        return JSON.stringify({ deleted: true, message: 'Reading deleted successfully.' })
      } catch (err: any) {
        return JSON.stringify({ deleted: false, message: err.message ?? 'Failed to delete.' })
      }
    },
  })

  return [submitCheckin, getRecentReadings, updateCheckin, deleteCheckin]
}
