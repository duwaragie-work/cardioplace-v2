import { Injectable, Logger } from '@nestjs/common'
import { Type } from '@google/genai'
import type { FunctionDeclaration } from '@google/genai'
import { DailyJournalService } from '../../daily_journal/daily_journal.service.js'
import { AlertEngineService } from '../../daily_journal/services/alert-engine.service.js'
import type { SessionSymptoms } from '../../daily_journal/engine/types.js'
import { GeminiService } from '../../gemini/gemini.service.js'

// Voice-tool I/O — argument shapes are stable contract with the Gemini Live
// system prompt; field-name and sentinel-value changes ripple into the
// prompt and must stay in sync.

export interface ToolContext {
  userId: string
  /** IANA TZ from User.timezone (defaults to America/New_York). Used to
   *  resolve "now" / "today" the same way the Python tool did. */
  timezone: string
}

export interface CheckinSummary {
  systolicBP?: number
  diastolicBP?: number
  weight?: number
  medicationTaken?: boolean
  symptoms: string[]
  saved: boolean
}

export interface UpdateSummary {
  entryId: string
  entryDate?: string
  systolicBP?: number
  diastolicBP?: number
  weight?: number
  medicationTaken?: boolean
  symptoms: string[]
  updated: boolean
}

export interface DeleteSummary {
  entryIds: string[]
  deletedCount: number
  failedCount: number
  success: boolean
  message: string
}

/** A side-channel fan-out the orchestrator forwards to the Socket.io gateway. */
export type ToolEvent =
  | { kind: 'action'; type: string; detail: string }
  | { kind: 'action_complete'; type: string; success: boolean; detail: string }
  | { kind: 'checkin_saved'; payload: CheckinSummary }
  | { kind: 'checkin_updated'; payload: UpdateSummary }
  | { kind: 'checkin_deleted'; payload: DeleteSummary }

export interface DispatchResult {
  /** Sent back to Gemini as the FunctionResponse body. */
  llmResponse: Record<string, unknown>
  /** Side-channel notifications relayed to the WebSocket client. */
  events: ToolEvent[]
}

@Injectable()
export class VoiceToolsService {
  private readonly logger = new Logger(VoiceToolsService.name)

  constructor(
    private readonly dailyJournal: DailyJournalService,
    private readonly gemini: GeminiService,
    private readonly alertEngine: AlertEngineService,
  ) {}

  /**
   * Gemini Live function declarations. Mirrors the Python ADK signatures
   * one-for-one so the system prompt and patient-facing UX stay identical
   * after the migration.
   */
  getToolDeclarations(): FunctionDeclaration[] {
    return [
      {
        name: 'submit_checkin',
        description:
          "Submit the patient's health check-in after all values have been confirmed. Call only once the patient has said yes to saving. Supports sparse entries (BP=0 means not provided) for partial logs.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            systolic_bp: { type: Type.INTEGER, description: 'Top number 60-250. 0 = not provided (sparse log).' },
            diastolic_bp: { type: Type.INTEGER, description: 'Bottom number 40-150. 0 = not provided (sparse log).' },
            medication_taken: { type: Type.BOOLEAN, description: 'Whether the patient took all medications.' },
            weight: { type: Type.NUMBER, description: 'Weight in lbs. 0 = not provided.' },
            symptoms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Legacy freeform symptom list. Prefer the structured booleans below.' },
            notes: { type: Type.STRING, description: 'Extra notes. ALWAYS in English.' },
            entry_date: { type: Type.STRING, description: 'YYYY-MM-DD or "" for today.' },
            measurement_time: { type: Type.STRING, description: 'HH:mm 24-hour. Pass "now"/"just now" for current; the system substitutes patient timezone.' },
            pulse: { type: Type.INTEGER, description: 'Heart rate 30-220. 0 = not provided.' },
            position: { type: Type.STRING, description: 'SITTING / STANDING / LYING. "" = not provided.' },
            medication_scheduled_later: { type: Type.BOOLEAN, description: 'True when the dose is scheduled for later (NOT missed).' },
            severe_headache: { type: Type.BOOLEAN },
            visual_changes: { type: Type.BOOLEAN },
            altered_mental_status: { type: Type.BOOLEAN },
            chest_pain_or_dyspnea: { type: Type.BOOLEAN },
            focal_neuro_deficit: { type: Type.BOOLEAN },
            severe_epigastric_pain: { type: Type.BOOLEAN },
            new_onset_headache: { type: Type.BOOLEAN, description: 'Pregnancy-only trigger; safely ignored otherwise.' },
            ruq_pain: { type: Type.BOOLEAN, description: 'Right-upper-quadrant pain (pregnancy-only trigger).' },
            edema: { type: Type.BOOLEAN, description: 'Pregnancy-only trigger; safely ignored otherwise.' },
            // Cluster 6 (Manisha 5/10/26) — feed brady-symptomatic, palpitations,
            // orthostatic, HF-decompensation, and DHP-CCB side-effect rules.
            dizziness: { type: Type.BOOLEAN, description: 'Patient reports feeling dizzy or lightheaded.' },
            syncope: { type: Type.BOOLEAN, description: 'Patient fainted or had a near-fainting episode recently.' },
            palpitations: { type: Type.BOOLEAN, description: "Patient reports heart racing or fluttering." },
            leg_swelling: { type: Type.BOOLEAN, description: 'Patient reports new leg/foot swelling or rapid weight gain. Routes to HF decompensation and DHP-CCB rules.' },
            // Cluster 8 (Manisha 5/18/26, P0) — ACE-angioedema airway emergency.
            // Fires TIER_1_ANGIOEDEMA from a single reading, any patient. Voice
            // parity with text — pilot blocker resolved on the voice surface.
            face_swelling: { type: Type.BOOLEAN, description: 'Patient reports new swelling of the face, lips, or tongue. Airway-emergency trigger (TIER_1_ANGIOEDEMA) — fires regardless of BP value.' },
            throat_tightness: { type: Type.BOOLEAN, description: 'Patient reports throat tightening or difficulty swallowing. Airway-emergency trigger (TIER_1_ANGIOEDEMA) — fires regardless of BP value.' },
            other_symptoms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Patient-described symptoms not covered by the structured booleans. ALWAYS English.' },
            measurement_conditions: {
              type: Type.OBJECT,
              description: 'B1 pre-measurement checklist. Only include keys the patient explicitly answered.',
              properties: {
                noCaffeine: { type: Type.BOOLEAN },
                noSmoking: { type: Type.BOOLEAN },
                noExercise: { type: Type.BOOLEAN },
                bladderEmpty: { type: Type.BOOLEAN },
                seatedQuietly: { type: Type.BOOLEAN },
                posturalSupport: { type: Type.BOOLEAN },
                notTalking: { type: Type.BOOLEAN },
                cuffOnBareArm: { type: Type.BOOLEAN },
              },
            },
            missed_medications: {
              type: Type.ARRAY,
              description: 'Per-medication miss detail. Backend resolves drug_name → medicationId and filters AS_NEEDED.',
              items: {
                type: Type.OBJECT,
                properties: {
                  drug_name: { type: Type.STRING },
                  reason: { type: Type.STRING, description: 'FORGOT / SIDE_EFFECTS / RAN_OUT / COST / INTENTIONAL / OTHER' },
                  missed_doses: { type: Type.INTEGER },
                },
                required: ['drug_name', 'reason'],
              },
            },
          },
          required: ['medication_taken'],
        },
      },
      {
        name: 'get_recent_readings',
        description: "Retrieve the patient's recent BP readings. Use for history questions or to find entry_id before update/delete.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            days: { type: Type.INTEGER, description: 'Number of days back, 1-30. Defaults to 7.' },
          },
        },
      },
      {
        name: 'update_checkin',
        description:
          'Modify an existing reading. MUST first call get_recent_readings to get the entry_id. Sentinel defaults: 0/""/[] leave the field unchanged.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            entry_id: { type: Type.STRING },
            systolic_bp: { type: Type.INTEGER, description: '0 = leave unchanged' },
            diastolic_bp: { type: Type.INTEGER, description: '0 = leave unchanged' },
            medication_taken: { type: Type.STRING, description: '"yes" / "no" / "" leave unchanged' },
            weight: { type: Type.NUMBER, description: '0 = leave unchanged' },
            symptoms: { type: Type.ARRAY, items: { type: Type.STRING }, description: '[] = leave unchanged' },
            notes: { type: Type.STRING, description: '"" = leave unchanged. ALWAYS English.' },
            measurement_time: { type: Type.STRING, description: 'HH:mm. "" = leave unchanged.' },
          },
          required: ['entry_id'],
        },
      },
      {
        name: 'delete_checkin',
        description:
          "Remove one or more readings. MUST first call get_recent_readings, read back the rows to the patient, and get explicit confirmation.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            entry_ids: { type: Type.STRING, description: 'Comma-separated entry IDs ("abc123" or "abc123,def456").' },
          },
          required: ['entry_ids'],
        },
      },
      {
        name: 'submit_bp_from_photo',
        description:
          'Run OCR on a cuff-display photo. Returns parsed numbers + confidence. The agent MUST verbally confirm with the patient before calling submit_checkin.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            image_base64: { type: Type.STRING, description: 'Base64 photo, no data: prefix.' },
            mime_type: { type: Type.STRING, description: 'image/jpeg, image/png, image/webp, image/heic.' },
          },
          required: ['image_base64', 'mime_type'],
        },
      },
      {
        name: 'evaluate_reading',
        description:
          "Ask the patient's personalised rule engine what a BP / HR reading means FOR THIS PATIENT. " +
          'Returns the canonical patient-tier alert message signed off by the clinical director ' +
          '(or null if the reading is within their targets). ' +
          "Call this whenever the patient asks 'what does X over Y mean for me', 'is N safe for me', " +
          'or wants an interpretation of a specific reading. ' +
          'Do NOT use this to log a check-in — use submit_checkin for that. ' +
          'Nothing is persisted; the engine only computes the verdict.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            systolic_bp: { type: Type.NUMBER, description: 'Systolic BP in mmHg.' },
            diastolic_bp: { type: Type.NUMBER, description: 'Diastolic BP in mmHg.' },
            heart_rate: { type: Type.NUMBER, description: 'Pulse in bpm (optional, 0 = unspecified).' },
            symptoms: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description:
                'Optional symptoms the patient mentioned alongside the reading ' +
                '(e.g. dizziness, chest pain, palpitations, severe headache, swelling).',
            },
          },
          required: ['systolic_bp', 'diastolic_bp'],
        },
      },
    ]
  }

  async dispatch(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<DispatchResult> {
    try {
      switch (name) {
        case 'submit_checkin':
          return await this.submitCheckin(args, ctx)
        case 'get_recent_readings':
          return await this.getRecentReadings(args, ctx)
        case 'update_checkin':
          return await this.updateCheckin(args, ctx)
        case 'delete_checkin':
          return await this.deleteCheckin(args, ctx)
        case 'submit_bp_from_photo':
          return await this.submitBpFromPhoto(args, ctx)
        case 'evaluate_reading':
          return await this.evaluateReading(args, ctx)
        default:
          return {
            llmResponse: { ok: false, error: `Unknown tool: ${name}` },
            events: [],
          }
      }
    } catch (err) {
      this.logger.error(`Tool ${name} failed`, err)
      return {
        llmResponse: { ok: false, error: (err as Error).message ?? 'tool failure' },
        events: [],
      }
    }
  }

  // ── Tool 1: submit_checkin ─────────────────────────────────────────────────

  private async submitCheckin(
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<DispatchResult> {
    const sbp = toInt(args.systolic_bp, 0)
    const dbp = toInt(args.diastolic_bp, 0)
    // Anti-hallucination guard: a BP reading is two numbers — if the LLM
    // supplies one without the other, it almost certainly hallucinated the
    // value it has and never heard the value it doesn't. Refuse the save and
    // make the model ask the patient. True sparse logging (no BP at all)
    // still works because both will be 0 here.
    const sbpProvided = sbp > 0
    const dbpProvided = dbp > 0
    if (sbpProvided !== dbpProvided) {
      this.logger.warn(`Asymmetric BP rejected: sbp=${sbp} dbp=${dbp} — likely hallucination`)
      return {
        llmResponse: {
          saved: false,
          message:
            `Got ${sbp || 'no'} over ${dbp || 'no'} — that's incomplete. ` +
            'A blood pressure reading needs BOTH numbers. ' +
            'Please ask the patient for the missing number and re-call submit_checkin, ' +
            'OR leave both at 0 if the patient is only logging medication/symptoms.',
        },
        events: [],
      }
    }
    const bpProvided = sbpProvided && dbpProvided
    if (bpProvided && (sbp < 60 || sbp > 250 || dbp < 40 || dbp > 150)) {
      this.logger.warn(`BP out of range: ${sbp}/${dbp} — rejecting`)
      return {
        llmResponse: {
          saved: false,
          message: `BP values out of range (got ${sbp}/${dbp}). Systolic must be 60-250, diastolic 40-150. Please ask the patient to repeat.`,
        },
        events: [],
      }
    }

    const symptoms = toStringArray(args.symptoms)
    const medicationTaken = toBool(args.medication_taken, false)
    const weight = toNumber(args.weight, 0)
    const detail = `BP=${sbp}/${dbp} meds=${medicationTaken ? 'taken' : 'missed'} symptoms=${
      symptoms.length ? symptoms.join(',') : 'none'
    } weight=${weight || 'N/A'}`

    const events: ToolEvent[] = [
      { kind: 'action', type: 'submitting_checkin', detail },
    ]

    // Resolve date+time in patient timezone.
    const nowParts = formatInTz(new Date(), ctx.timezone)
    let resolvedDate = `${nowParts.y}-${nowParts.mo}-${nowParts.d}`
    const entryDate = asString(args.entry_date, '').trim()
    if (entryDate && /^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      resolvedDate = entryDate
    } else if (entryDate) {
      this.logger.warn(`Invalid entry_date "${entryDate}" — defaulting to today in ${ctx.timezone}`)
    }
    let resolvedTime = `${nowParts.h}:${nowParts.mi}`
    const measurementTime = asString(args.measurement_time, '').trim()
    if (measurementTime) {
      const mt = measurementTime.toLowerCase()
      if (['now', 'current', 'current time', 'right now', 'just now'].includes(mt)) {
        resolvedTime = `${nowParts.h}:${nowParts.mi}`
      } else {
        resolvedTime = measurementTime
      }
    }

    const measuredAtIso = isoFromTzWallclock(resolvedDate, resolvedTime, ctx.timezone)

    const dto: Record<string, unknown> = {
      measuredAt: measuredAtIso,
      medicationTaken,
      symptoms,
      notes: asString(args.notes, ''),
    }
    if (bpProvided) {
      dto.systolicBP = sbp
      dto.diastolicBP = dbp
    }
    if (weight > 0) dto.weight = weight
    const pulse = toInt(args.pulse, 0)
    if (pulse > 0) dto.pulse = pulse
    const position = asString(args.position, '').trim().toUpperCase()
    if (['SITTING', 'STANDING', 'LYING'].includes(position)) {
      dto.position = position
    }
    if (toBool(args.medication_scheduled_later, false)) {
      dto.medicationScheduledLater = true
    }
    dto.severeHeadache = toBool(args.severe_headache, false)
    dto.visualChanges = toBool(args.visual_changes, false)
    dto.alteredMentalStatus = toBool(args.altered_mental_status, false)
    dto.chestPainOrDyspnea = toBool(args.chest_pain_or_dyspnea, false)
    dto.focalNeuroDeficit = toBool(args.focal_neuro_deficit, false)
    dto.severeEpigastricPain = toBool(args.severe_epigastric_pain, false)
    dto.newOnsetHeadache = toBool(args.new_onset_headache, false)
    dto.ruqPain = toBool(args.ruq_pain, false)
    dto.edema = toBool(args.edema, false)
    // Cluster 6 — universal symptom signals.
    dto.dizziness = toBool(args.dizziness, false)
    dto.syncope = toBool(args.syncope, false)
    dto.palpitations = toBool(args.palpitations, false)
    dto.legSwelling = toBool(args.leg_swelling, false)
    // Cluster 8 (Manisha 5/18/26, P0) — ACE-angioedema airway emergency.
    // Setting either of these on a JournalEntry trips TIER_1_ANGIOEDEMA in
    // the rule engine regardless of BP value (single-reading, any patient).
    dto.faceSwelling = toBool(args.face_swelling, false)
    dto.throatTightness = toBool(args.throat_tightness, false)
    const otherSymptoms = toStringArray(args.other_symptoms)
    if (otherSymptoms.length) dto.otherSymptoms = otherSymptoms

    if (args.measurement_conditions && typeof args.measurement_conditions === 'object') {
      const allowed = new Set([
        'noCaffeine', 'noSmoking', 'noExercise', 'bladderEmpty',
        'seatedQuietly', 'posturalSupport', 'notTalking', 'cuffOnBareArm',
      ])
      const cleaned: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(args.measurement_conditions as Record<string, unknown>)) {
        if (allowed.has(k) && typeof v === 'boolean') cleaned[k] = v
      }
      if (Object.keys(cleaned).length) dto.measurementConditions = cleaned
    }

    if (Array.isArray(args.missed_medications) && args.missed_medications.length) {
      const cleaned: Array<{ drugName: string; reason: string; missedDoses: number }> = []
      for (const row of args.missed_medications) {
        if (!row || typeof row !== 'object') continue
        const r = row as Record<string, unknown>
        const drugName = asString(r.drug_name, '').trim()
        const reason = asString(r.reason, '').trim().toUpperCase()
        if (!drugName || !reason) continue
        const doses = clampInt(toInt(r.missed_doses, 1), 1, 10)
        cleaned.push({ drugName, reason, missedDoses: doses })
      }
      if (cleaned.length) dto.missedMedications = cleaned
    }

    let saved = false
    let savedMessage = 'There was a problem saving the check-in. Please try again later.'
    try {
      // Same DTO shape NestJS daily-journal controller expects (validated by
      // CreateJournalEntryDto). Calling the service directly skips network +
      // ValidationPipe, but we shape the payload to match so behaviour stays
      // identical.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.dailyJournal.create(ctx.userId, dto as any)
      saved = true
      savedMessage = `Check-in saved successfully for ${resolvedDate} at ${resolvedTime}. The care team has been notified.`
    } catch (err) {
      this.logger.error('submit_checkin: dailyJournal.create failed', err)
      saved = false
    }

    const checkinSummary: CheckinSummary = {
      systolicBP: bpProvided ? sbp : undefined,
      diastolicBP: bpProvided ? dbp : undefined,
      weight: weight > 0 ? weight : undefined,
      medicationTaken,
      symptoms,
      saved,
    }
    events.push({ kind: 'checkin_saved', payload: checkinSummary })
    events.push({
      kind: 'action_complete',
      type: 'submitting_checkin',
      success: saved,
      detail: `BP=${sbp}/${dbp} saved=${saved}`,
    })

    return {
      llmResponse: {
        saved,
        entry_date_used: resolvedDate,
        measurement_time_used: resolvedTime,
        message: savedMessage,
      },
      events,
    }
  }

  // ── Tool 2: get_recent_readings ────────────────────────────────────────────

  private async getRecentReadings(
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<DispatchResult> {
    const days = clampInt(toInt(args.days, 7), 1, 30)
    const events: ToolEvent[] = [
      { kind: 'action', type: 'fetching_readings', detail: `Fetching last ${days} days` },
    ]

    try {
      // Mirror the Python flow: startDate/endDate window in patient TZ,
      // newest 5 entries first, return a compact line-per-entry summary.
      const now = new Date()
      const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
      const result = await this.dailyJournal.findAll(
        ctx.userId,
        startDate.toISOString(),
        now.toISOString(),
        5,
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries = (result?.data ?? []) as Array<any>
      const lines: string[] = []
      for (const e of entries.slice(0, 5)) {
        const entryId = e.id ?? 'unknown'
        const measuredAt: string = e.measuredAt instanceof Date
          ? e.measuredAt.toISOString()
          : String(e.measuredAt ?? '')
        const date = measuredAt.length >= 10 ? measuredAt.slice(0, 10) : 'unknown'
        const time = measuredAt.length >= 16 ? measuredAt.slice(11, 16) : ''
        const sbp = e.systolicBP ?? '?'
        const dbp = e.diastolicBP ?? '?'
        const med = e.medicationTaken ? 'yes' : 'no'
        const sym = Array.isArray(e.otherSymptoms) && e.otherSymptoms.length
          ? e.otherSymptoms.join(', ')
          : 'none'
        const timeStr = time ? ` at ${time}` : ''
        lines.push(`entry_id="${entryId}" | ${date}${timeStr} | BP ${sbp}/${dbp} | meds ${med} | symptoms: ${sym}`)
      }
      const summary = lines.length ? lines.join('\n') : 'No readings found.'
      events.push({
        kind: 'action_complete',
        type: 'fetching_readings',
        success: true,
        detail: `Found ${lines.length} readings`,
      })
      return {
        llmResponse: { summary, count: lines.length },
        events,
      }
    } catch (err) {
      this.logger.error('get_recent_readings failed', err)
      events.push({
        kind: 'action_complete',
        type: 'fetching_readings',
        success: false,
        detail: 'Connection failed',
      })
      return {
        llmResponse: {
          summary: `Could not fetch readings — ${(err as Error).message}`,
          count: 0,
        },
        events,
      }
    }
  }

  // ── Tool 3: update_checkin ─────────────────────────────────────────────────

  private async updateCheckin(
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<DispatchResult> {
    const entryId = asString(args.entry_id, '').trim()
    if (!entryId) {
      return {
        llmResponse: { updated: false, message: 'Missing entry_id.' },
        events: [],
      }
    }

    const dto: Record<string, unknown> = {}

    // measuredAt: combine the existing date with a new HH:mm if the model
    // only sent a time (mirrors Python flow: GET /:id then rebuild).
    const measurementTime = asString(args.measurement_time, '').trim()
    if (measurementTime) {
      try {
        const existing = await this.dailyJournal.findOne(ctx.userId, entryId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existingIso = (existing?.data as any)?.measuredAt
        const existingDate =
          existingIso instanceof Date
            ? existingIso.toISOString().slice(0, 10)
            : typeof existingIso === 'string' && existingIso.length >= 10
              ? existingIso.slice(0, 10)
              : null
        if (existingDate) {
          dto.measuredAt = isoFromTzWallclock(existingDate, measurementTime, ctx.timezone)
        }
      } catch (err) {
        this.logger.warn(`update_checkin: could not resolve measuredAt for ${entryId}: ${(err as Error).message}`)
      }
    }

    const sbp = toInt(args.systolic_bp, 0)
    if (sbp > 0) dto.systolicBP = sbp
    const dbp = toInt(args.diastolic_bp, 0)
    if (dbp > 0) dto.diastolicBP = dbp
    const medicationTakenStr = asString(args.medication_taken, '').trim().toLowerCase()
    if (medicationTakenStr) {
      if (['yes', 'true', 'taken'].includes(medicationTakenStr)) dto.medicationTaken = true
      else if (['no', 'false', 'missed', 'not taken'].includes(medicationTakenStr)) dto.medicationTaken = false
    }
    const weight = toNumber(args.weight, 0)
    if (weight > 0) dto.weight = weight
    const symptoms = toStringArray(args.symptoms)
    if (symptoms.length) dto.symptoms = symptoms
    const notes = asString(args.notes, '')
    if (notes) dto.notes = notes

    if (Object.keys(dto).length === 0) {
      return {
        llmResponse: { updated: false, message: 'No fields to update.' },
        events: [],
      }
    }

    const changes: string[] = []
    if ('systolicBP' in dto) changes.push(`systolic=${dto.systolicBP}`)
    if ('diastolicBP' in dto) changes.push(`diastolic=${dto.diastolicBP}`)
    if ('medicationTaken' in dto) changes.push(`medication=${dto.medicationTaken ? 'taken' : 'missed'}`)
    if ('weight' in dto) changes.push(`weight=${dto.weight}lbs`)
    if ('symptoms' in dto) {
      const syms = dto.symptoms as string[]
      changes.push(`symptoms=${syms.length ? syms.join(',') : 'none'}`)
    }
    const events: ToolEvent[] = [
      {
        kind: 'action',
        type: 'updating_checkin',
        detail: `entry=${entryId} changes=[${changes.join(', ')}]`,
      },
    ]

    let updated = false
    let entryDate = ''
    let finalSbp = sbp || 0
    let finalDbp = dbp || 0
    let finalWeight = weight || 0
    let finalMed = dto.medicationTaken === true
    let finalSymptoms = symptoms

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await this.dailyJournal.update(ctx.userId, entryId, dto as any)
      updated = true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (result?.data as any) ?? {}
      const ma: string = data.measuredAt instanceof Date
        ? data.measuredAt.toISOString()
        : String(data.measuredAt ?? '')
      entryDate = ma.length >= 10 ? ma.slice(0, 10) : ''
      finalSbp = data.systolicBP ?? finalSbp
      finalDbp = data.diastolicBP ?? finalDbp
      finalWeight = data.weight ?? finalWeight
      finalMed = data.medicationTaken ?? finalMed
      finalSymptoms = Array.isArray(data.otherSymptoms) ? data.otherSymptoms : finalSymptoms
    } catch (err) {
      this.logger.error(`update_checkin failed for ${entryId}`, err)
    }

    const summary: UpdateSummary = {
      entryId,
      entryDate: entryDate || undefined,
      systolicBP: finalSbp || undefined,
      diastolicBP: finalDbp || undefined,
      weight: finalWeight > 0 ? finalWeight : undefined,
      medicationTaken: finalMed,
      symptoms: finalSymptoms,
      updated,
    }
    events.push({ kind: 'checkin_updated', payload: summary })
    events.push({
      kind: 'action_complete',
      type: 'updating_checkin',
      success: updated,
      detail: `entry=${entryId} updated=${updated}`,
    })

    return {
      llmResponse: {
        updated,
        message: updated
          ? 'Reading updated successfully.'
          : 'Could not update the reading. Please try again.',
      },
      events,
    }
  }

  // ── Tool 4: delete_checkin ─────────────────────────────────────────────────

  private async deleteCheckin(
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<DispatchResult> {
    const raw = args.entry_ids
    let ids: string[]
    if (Array.isArray(raw)) {
      ids = raw.map((x) => String(x).trim()).filter(Boolean)
    } else {
      ids = String(raw ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    }

    if (ids.length === 0) {
      return {
        llmResponse: { deleted_count: 0, failed_count: 0, message: 'No entry IDs provided.' },
        events: [
          { kind: 'action_complete', type: 'deleting_checkin', success: false, detail: 'No entry IDs provided' },
        ],
      }
    }

    const events: ToolEvent[] = [
      {
        kind: 'action',
        type: 'deleting_checkin',
        detail: `Deleting ${ids.length} entry(ies): ${ids.slice(0, 5).join(', ')}`,
      },
    ]

    let deletedCount = 0
    let failedCount = 0
    for (const eid of ids) {
      try {
        await this.dailyJournal.delete(ctx.userId, eid)
        deletedCount += 1
      } catch (err) {
        failedCount += 1
        this.logger.warn(`delete_checkin: ${eid} failed: ${(err as Error).message}`)
      }
    }

    let message: string
    if (failedCount === 0) {
      message = deletedCount === 1
        ? 'Reading deleted successfully.'
        : `All ${deletedCount} readings deleted successfully.`
    } else if (deletedCount === 0) {
      message = 'Could not delete the reading(s). Please try again.'
    } else {
      message = `Deleted ${deletedCount} reading(s), but ${failedCount} could not be deleted.`
    }

    const summary: DeleteSummary = {
      entryIds: ids,
      deletedCount,
      failedCount,
      success: failedCount === 0,
      message,
    }
    events.push({ kind: 'checkin_deleted', payload: summary })
    events.push({
      kind: 'action_complete',
      type: 'deleting_checkin',
      success: failedCount === 0,
      detail: message,
    })

    return {
      llmResponse: { deleted_count: deletedCount, failed_count: failedCount, message },
      events,
    }
  }

  // ── Tool 5: submit_bp_from_photo ───────────────────────────────────────────

  private async submitBpFromPhoto(
    args: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<DispatchResult> {
    const imageBase64 = asString(args.image_base64, '')
    const mimeType = asString(args.mime_type, '')
    if (!imageBase64 || !mimeType) {
      return {
        llmResponse: {
          parsed: false,
          message: 'Missing image or mime type. Ask the patient to send the photo again.',
        },
        events: [],
      }
    }

    try {
      const result = await this.gemini.extractBpFromImage(imageBase64, mimeType)
      // Match the Python tool's return shape.
      if (result.sbp != null && result.dbp != null && result.confidence > 0) {
        return {
          llmResponse: {
            parsed: true,
            sbp: result.sbp,
            dbp: result.dbp,
            pulse: result.pulse,
            confidence: result.confidence,
            message:
              `Read ${result.sbp} over ${result.dbp}` +
              (result.pulse ? `, pulse ${result.pulse}` : '') +
              ' — confirm with the patient before saving.',
          },
          events: [],
        }
      }
      return {
        llmResponse: {
          parsed: false,
          code: 'LOW_CONFIDENCE',
          message: 'Could not read the cuff clearly. Ask the patient to read the numbers out loud.',
        },
        events: [],
      }
    } catch (err) {
      this.logger.error('submit_bp_from_photo failed', err)
      return {
        llmResponse: {
          parsed: false,
          message: 'Photo OCR failed. Ask the patient to read the numbers out loud.',
        },
        events: [],
      }
    }
  }

  // ── Tool 6: evaluate_reading ───────────────────────────────────────────────
  // Mirrors the text-chat tool: ask the rule engine what THIS reading means
  // for THIS patient without persisting anything. The engine returns the
  // canonical patient-tier alert wording from the signed-off registry.

  private async evaluateReading(
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<DispatchResult> {
    const sbp = toInt(args.systolic_bp, 0)
    const dbp = toInt(args.diastolic_bp, 0)
    if (sbp <= 0 || dbp <= 0) {
      return {
        llmResponse: {
          evaluated: false,
          message: 'systolic_bp and diastolic_bp must be positive numbers.',
        },
        events: [],
      }
    }
    const pulseRaw = toInt(args.heart_rate, 0)
    const pulse = pulseRaw > 0 ? pulseRaw : null
    const symptoms = mapVoiceSymptomsToFlags(args.symptoms)
    try {
      const result = await this.alertEngine.evaluateAdHoc({
        userId: ctx.userId,
        systolicBP: sbp,
        diastolicBP: dbp,
        pulse,
        symptoms,
      })
      return {
        llmResponse: { ...result },
        events: [],
      }
    } catch (err) {
      this.logger.error('evaluate_reading failed', err)
      return {
        llmResponse: {
          evaluated: false,
          message: 'Reading evaluation failed.',
        },
        events: [],
      }
    }
  }
}

/**
 * Voice mirror of the text-chat symptom mapper — folds the loose
 * `symptoms: string[]` the model passes (e.g. ["dizziness","chest pain"])
 * into the structured-symptom booleans the rule engine consumes.
 */
function mapVoiceSymptomsToFlags(raw: unknown): Partial<SessionSymptoms> | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const flags: Partial<SessionSymptoms> = {}
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const k = item.trim().toLowerCase()
    if (!k) continue
    if (k === 'severeheadache' || k.includes('severe headache')) flags.severeHeadache = true
    else if (k === 'newonsetheadache' || k.includes('new headache') || k.includes('new-onset')) flags.newOnsetHeadache = true
    else if (k === 'visualchanges' || k.includes('vision') || k.includes('blurr')) flags.visualChanges = true
    else if (k === 'alteredmentalstatus' || k.includes('confus') || k.includes('mental status')) flags.alteredMentalStatus = true
    else if (k === 'chestpainordyspnea' || k.includes('chest pain') || k.includes('chest tight') || k.includes('dyspnea')) flags.chestPainOrDyspnea = true
    else if (k === 'focalneurodeficit' || k.includes('one side') || k.includes('weakness')) flags.focalNeuroDeficit = true
    else if (k === 'severeepigastricpain' || k.includes('epigastric')) flags.severeEpigastricPain = true
    else if (k === 'ruqpain' || k.includes('ruq') || k.includes('right upper')) flags.ruqPain = true
    else if (k === 'edema' || k === 'swelling') flags.edema = true
    else if (k === 'dizziness' || k.includes('dizzy') || k.includes('lighthead')) flags.dizziness = true
    else if (k === 'syncope' || k.includes('faint') || k.includes('pass out')) flags.syncope = true
    else if (k === 'palpitations' || k.includes('palpit') || k.includes('flutter')) flags.palpitations = true
    else if (k === 'legswelling' || k.includes('leg swell') || k.includes('ankle swell')) flags.legSwelling = true
    else if (k === 'fatigue' || k.includes('tired')) flags.fatigue = true
    else if (k === 'shortnessofbreath' || k.includes('short of breath') || k.includes('breathless')) flags.shortnessOfBreath = true
    else if (k === 'drycough' || k.includes('dry cough')) flags.dryCough = true
    else if (k === 'nsaiduse' || k.includes('nsaid') || k.includes('ibuprofen')) flags.nsaidUse = true
    else if (k === 'faceswelling' || k.includes('face swell')) flags.faceSwelling = true
    else if (k === 'throattightness' || k.includes('throat')) flags.throatTightness = true
  }
  return Object.keys(flags).length > 0 ? flags : undefined
}

// ── Coercion helpers ─────────────────────────────────────────────────────────

function toInt(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && v.trim()) {
    const n = parseInt(v, 10)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function toNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    if (['true', 'yes', '1'].includes(v.toLowerCase())) return true
    if (['false', 'no', '0'].includes(v.toLowerCase())) return false
  }
  return fallback
}

function asString(v: unknown, fallback: string): string {
  if (typeof v === 'string') return v
  if (v == null) return fallback
  return String(v)
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x).trim()).filter(Boolean)
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

interface TzParts { y: string; mo: string; d: string; h: string; mi: string }

function formatInTz(date: Date, tz: string): TzParts {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date)
  } catch {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date)
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute') }
}

/**
 * Build an ISO 8601 timestamp from a wall-clock date+time interpreted in
 * `tz`. Computes the UTC offset by formatting `Date.UTC(...)` in `tz` and
 * comparing back — matches Python's zoneinfo behaviour incl. DST.
 */
function isoFromTzWallclock(dateStr: string, timeStr: string, tz: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  const t = /^(\d{1,2}):(\d{2})$/.exec(timeStr)
  if (!m || !t) {
    return new Date().toISOString()
  }
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  const d = parseInt(m[3], 10)
  const h = parseInt(t[1], 10)
  const mi = parseInt(t[2], 10)

  // First guess at UTC, then correct by the local offset of that guess.
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, 0)
  const offsetMs = tzOffsetMs(utcGuess, tz)
  return new Date(utcGuess - offsetMs).toISOString()
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const date = new Date(utcMs)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(date)
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10)
  const localMs = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour'), get('minute'), get('second'),
  )
  return localMs - utcMs
}
