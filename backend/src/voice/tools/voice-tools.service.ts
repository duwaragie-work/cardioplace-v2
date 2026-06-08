import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Type } from '@google/genai'
import type { FunctionDeclaration } from '@google/genai'
import { DailyJournalService } from '../../daily_journal/daily_journal.service.js'
import { AlertEngineService } from '../../daily_journal/services/alert-engine.service.js'
import type { SessionSymptoms } from '../../daily_journal/engine/types.js'
import { GeminiService } from '../../gemini/gemini.service.js'
import { isIntakeIncompleteError } from '../../chat/tools/journal-tools.js'
import { IntakeStatusService } from '../../intake/intake-status.service.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import {
  EMERGENCY_EVENTS,
  type EmergencyFlaggedPayload,
} from '../../chat/emergency-events.js'
import { isoFromTzWallclock } from '../../common/datetime.js'
import { normaliseWeightToKg } from '../../common/units.js'

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
    private readonly intakeStatusService: IntakeStatusService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
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
            weight: { type: Type.NUMBER, description: 'Weight as a number — whatever value the patient said. 0 = not provided. Set weight_unit to specify lbs or kg.' },
            weight_unit: { type: Type.STRING, description: 'Unit for `weight`: "LBS" or "KG". Use whichever unit the patient actually said — do NOT convert in your head. Defaults to LBS when omitted.' },
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
            session_id: {
              type: Type.STRING,
              description:
                'Optional session-grouping UUID. When recording MULTIPLE readings as one session ' +
                '(AFib patients always; or anyone you asked to take ≥2), generate ONE UUID at session ' +
                'start and pass the SAME value on every submit_checkin call in that session. To ADD a ' +
                'reading to an EXISTING session beyond the 5-min proximity window, first call ' +
                'get_recent_readings, read sessionId off an entry in that session, and reuse it on the ' +
                'new submit_checkin. Omit for one-off check-ins. "" = omit.',
            },
          },
          required: ['medication_taken'],
        },
      },
      {
        name: 'get_recent_readings',
        description:
          "Retrieve the patient's recent BP readings. Use for history questions or to find entry_id before update/delete. " +
          'Bug 21c — triggers on ANY patient phrasing meaning "show me my past readings" — ' +
          'e.g. "give me my readings", "show me my readings", "show me my BP", ' +
          '"what\'s my BP history", "list my readings", "what are my readings", ' +
          '"my history", "my check-ins", "my measurements", "my recent BPs", ' +
          '"show me my last reading", "what was my last reading".',
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
          'Modify an existing reading. MUST first call get_recent_readings to get the entry_id. ' +
          'TARGET RESOLUTION: If the patient uses a natural-language reference ' +
          "(e.g. 'change the last reading', 'update my most recent BP', 'fix the one I just took'), " +
          'DO NOT ask them for the date and time — the newest entry returned by get_recent_readings ' +
          'IS the target. Read it back to the patient with the proposed change and get explicit ' +
          'verbal yes before calling. Sentinel defaults: 0/""/[] leave the field unchanged.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            entry_id: { type: Type.STRING },
            systolic_bp: { type: Type.INTEGER, description: '0 = leave unchanged' },
            diastolic_bp: { type: Type.INTEGER, description: '0 = leave unchanged' },
            medication_taken: { type: Type.STRING, description: '"yes" / "no" / "" leave unchanged' },
            weight: { type: Type.NUMBER, description: 'New weight. 0 = leave unchanged. Set weight_unit to specify lbs or kg.' },
            weight_unit: { type: Type.STRING, description: 'Unit for `weight`: "LBS" or "KG". Use whichever unit the patient said. Defaults to LBS.' },
            symptoms: { type: Type.ARRAY, items: { type: Type.STRING }, description: '[] = leave unchanged' },
            notes: { type: Type.STRING, description: '"" = leave unchanged. ALWAYS English.' },
            measurement_time: { type: Type.STRING, description: 'HH:mm. "" = leave unchanged.' },
            session_id: {
              type: Type.STRING,
              description:
                'Optional. Move this reading into the given session-grouping UUID. Most edits should ' +
                'LEAVE THIS OUT — the entry already has a session_id from record time and changing it ' +
                'would split or merge averaging groups. Only set when the patient explicitly asks to move ' +
                'a reading to a different session. "" = leave unchanged.',
            },
          },
          required: ['entry_id'],
        },
      },
      {
        name: 'delete_checkin',
        description:
          'Remove one or more readings. MUST first call get_recent_readings, read back the rows to the patient, and get explicit confirmation. ' +
          'TARGET RESOLUTION: If the patient uses a natural-language reference ' +
          "(e.g. 'delete the last reading', 'remove my most recent BP', 'delete the one I just took'), " +
          'DO NOT ask them for the date and time — the newest entry returned by get_recent_readings ' +
          'IS the target. Read it back ("Your most recent reading is one thirty eight over eighty ' +
          "five at eight thirty AM on June first — should I delete it?\") and only on explicit yes call this tool.",
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
      {
        name: 'check_intake_status',
        description:
          "Check whether the patient has completed their one-time clinical intake form. " +
          "Call this BEFORE the first submit_checkin / update_checkin / delete_checkin / " +
          "finalize_checkin in a conversation. If completed=false, do NOT call any of those " +
          "tools — the backend will 403 and the patient cannot save readings until intake is " +
          "done. Route them to intake_url instead. Read-only; nothing is persisted.",
        parameters: { type: Type.OBJECT, properties: {} },
      },
      {
        name: 'finalize_checkin',
        description:
          'Finalise a SINGLE-reading session — tells the rule engine to evaluate the just-saved ' +
          'entry NOW even though only one reading was taken. The engine normally requires ≥2 ' +
          'readings averaged in the same session before non-emergency rules fire; this flips ' +
          'singleReadingFinalized so the gate is bypassed for that one entry. ' +
          'WHEN TO CALL: only after a successful submit_checkin AND the patient said they will ' +
          'not take a second reading. Do NOT call for AFib patients — they need ≥3 readings; ' +
          'walk them through more submit_checkin calls instead. ' +
          "Required arg: entry_id from the previous submit_checkin's saved entry.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            entry_id: {
              type: Type.STRING,
              description: 'Entry id from the previous submit_checkin result.',
            },
          },
          required: ['entry_id'],
        },
      },
      {
        // Bug 12 — voice parity with the text `flag_emergency` tool. Without
        // this, a voice patient saying "I'm having a stroke" got only verbal
        // "call 911" — no EmergencyEvent row, no care-team page. Now voice
        // and text share the same emergency surface end-to-end.
        name: 'flag_emergency',
        description:
          'Flag an acute life-threatening emergency the patient is describing RIGHT NOW. ' +
          'Call ONLY for: crushing/severe chest pain, sudden inability to breathe, sudden numbness ' +
          'or weakness on one side, sudden vision loss, heart-attack / stroke feeling NOW, or heart ' +
          'racing combined with faintness. After calling, continue speaking to the patient with 911 ' +
          'guidance — the tool records the event and pages the care team in parallel.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            emergency_situation: {
              type: Type.STRING,
              description:
                'Short description of what the patient said happened (one sentence). Used in ' +
                'the care-team page and the audit trail.',
            },
          },
          required: ['emergency_situation'],
        },
      },
    ]
  }

  async dispatch(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<DispatchResult> {
    // Fail-loud multi-tenant guard: every dispatch MUST carry an authenticated
    // userId from the voice gateway's JWT handshake. If a future refactor ever
    // drops the JWT verify in voice.gateway.ts or forgets to thread userId
    // into ActiveSession, abort here rather than silently emit unscoped
    // Prisma queries downstream.
    if (typeof ctx.userId !== 'string' || ctx.userId.length === 0) {
      this.logger.error(
        `[SECURITY] dispatch_without_auth tool=${name} — refusing to execute`,
      )
      return {
        llmResponse: {
          ok: false,
          error: 'Voice tool dispatch requires an authenticated patient.',
        },
        events: [],
      }
    }
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
        case 'finalize_checkin':
          return await this.finalizeCheckin(args, ctx)
        case 'check_intake_status':
          return await this.checkIntakeStatus(ctx)
        case 'flag_emergency':
          return await this.flagEmergency(args, ctx)
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
    // Bug 5 fix — `medication_taken` is required by the schema, but Gemini may
    // still issue the call without it. Without this guard, the dispatcher
    // would default to `false` and silently flag the patient as non-adherent
    // (firing Stage-B medication-adherence alerts on someone who actually
    // took their meds). Mirror the text-side missing-field rejection.
    if (args.medication_taken === undefined || args.medication_taken === null) {
      this.logger.warn('submit_checkin rejected: medication_taken missing — asking patient first')
      return {
        llmResponse: {
          saved: false,
          reason: 'MISSING_FIELD',
          message:
            'I need to ask the patient whether they took their medication today before saving. ' +
            'Ask them now, then call submit_checkin again with medication_taken set.',
        },
        events: [],
      }
    }
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
    // Bug 19 + kg/lbs follow-up — tool now accepts BOTH units via the
    // new `weight_unit` arg ('LBS' | 'KG'). Default = LBS for back-compat
    // when the LLM omits the unit. JournalEntry.weight stores kg, so
    // normalise here. The submitCheckin response below still echoes raw
    // patient lbs for the frontend CheckinCard (which displays lbs).
    if (weight > 0) {
      const kg = normaliseWeightToKg(
        weight,
        typeof args.weight_unit === 'string' ? args.weight_unit : undefined,
      )
      if (kg > 0) dto.weight = kg
    }
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

    const sessionId = asString(args.session_id, '').trim()
    if (sessionId) dto.sessionId = sessionId

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
    let intakeIncomplete = false
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
      if (isIntakeIncompleteError(err)) {
        intakeIncomplete = true
        savedMessage =
          "Before I can save a check-in I need you to complete your one-time intake form. " +
          "Please go to /clinical-intake and come back when you're done."
      }
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
        ...(intakeIncomplete
          ? { reason: 'INTAKE_INCOMPLETE', intake_url: '/clinical-intake' }
          : {}),
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
      // ── LLM privacy boundary ───────────────────────────────────────────
      // The narrow `entry_id="…" | <date> | BP <sbp>/<dbp> | meds … | symptoms …`
      // line below is the privacy boundary between the JournalEntry row
      // (which carries internal columns like userId, source, sourceMetadata,
      // createdAt, updatedAt) and what the LLM receives. NEVER widen this
      // string to include internal fields — the model can quote them back
      // to the patient. Allow-list exception: `session_id` is intentionally
      // exposed (only when non-null) so the LLM can thread an existing
      // session through a subsequent submit_checkin (multi-reading
      // add-to-session flow for AFib and other clinically-grouped
      // sessions). It is a grouping label, never a security boundary —
      // composite { id, userId } scoping on every mutation still prevents
      // cross-tenant leak. Mirror chat/tools/journal-tools.ts
      // `get_recent_readings` if changing the shape.
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
        const sessionStr = e.sessionId ? ` | session_id="${e.sessionId}"` : ''
        lines.push(`entry_id="${entryId}" | ${date}${timeStr} | BP ${sbp}/${dbp} | meds ${med} | symptoms: ${sym}${sessionStr}`)
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
        } else {
          // Bug 6 fix — entry exists but has no measuredAt we can pivot on
          // (extremely unlikely; defensive). Reject rather than apply other
          // fields while silently dropping the requested time change.
          return {
            llmResponse: {
              updated: false,
              message:
                "I couldn't load that reading's existing date to rebase the new time. " +
                'Ask the patient to call get_recent_readings and confirm the entry id, then try again.',
            },
            events: [],
          }
        }
      } catch (err) {
        // Bug 6 fix — when the patient asked to change the time and
        // `findOne` failed (entry deleted, id hallucinated, permission slip),
        // do NOT silently proceed with the OTHER field changes while
        // dropping the time. Reject the whole update so the LLM tells the
        // patient honestly instead of claiming "Got it, I changed the time".
        this.logger.warn(`update_checkin: findOne failed for ${entryId}: ${(err as Error).message}`)
        return {
          llmResponse: {
            updated: false,
            message:
              "I couldn't load that reading to update its time. " +
              'Ask the patient to call get_recent_readings and confirm the entry id, then try again.',
          },
          events: [],
        }
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
    // Bug 19 + kg/lbs follow-up — same normalisation as submitCheckin.
    if (weight > 0) {
      const kg = normaliseWeightToKg(
        weight,
        typeof args.weight_unit === 'string' ? args.weight_unit : undefined,
      )
      if (kg > 0) dto.weight = kg
    }
    const symptoms = toStringArray(args.symptoms)
    if (symptoms.length) dto.symptoms = symptoms
    const notes = asString(args.notes, '')
    if (notes) dto.notes = notes
    const newSessionId = asString(args.session_id, '').trim()
    if (newSessionId) dto.sessionId = newSessionId

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
    // Bug 19 — dto.weight is now kg (post lbsToKg conversion above).
    if ('weight' in dto) changes.push(`weight=${dto.weight}kg`)
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

  /**
   * Finalise a single-reading session — flips singleReadingFinalized: true on
   * the entry so the engine's non-emergency gate is bypassed and Stage C
   * rules (BP-high, sbp-low, HR) re-evaluate on this lone reading. Voice
   * mirror of the text dispatcher's finalize_checkin case. Idempotent at
   * the service layer via updateMany.
   */
  private async finalizeCheckin(
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<DispatchResult> {
    const entryId = typeof args.entry_id === 'string' ? args.entry_id.trim() : ''
    if (!entryId) {
      return {
        llmResponse: {
          finalized: false,
          message: "entry_id is required — pass the id from the previous submit_checkin's saved entry.",
        },
        events: [],
      }
    }
    try {
      const result = await this.dailyJournal.finalizeSingleReadingSession(ctx.userId, entryId)
      return {
        llmResponse: {
          finalized: true,
          message: result.message ?? 'Check-in finalised; alerts re-evaluated.',
        },
        events: [],
      }
    } catch (err) {
      this.logger.error('finalize_checkin failed', err)
      return {
        llmResponse: {
          finalized: false,
          message: (err as Error)?.message ?? 'Failed to finalise check-in.',
        },
        events: [],
      }
    }
  }

  // ── Tool: check_intake_status ──────────────────────────────────────────────
  // Read-only precheck. Lets the voice LLM detect an INTAKE STATUS gap before
  // it tries submit_checkin (which would 403). Mirrors the text-chat tool of
  // the same name in journal-tools.ts case 'check_intake_status'.
  private async checkIntakeStatus(ctx: ToolContext): Promise<DispatchResult> {
    const status = await this.intakeStatusService.getStatus(ctx.userId)
    return {
      llmResponse: {
        completed: status.completed,
        profile_exists: status.profileExists,
        intake_url: '/clinical-intake',
        message: status.completed
          ? 'Intake is complete — you may proceed with check-ins.'
          : 'Intake is NOT complete. Do not call submit_checkin. Direct the patient to /clinical-intake first.',
      },
      events: [
        {
          kind: 'action',
          type: 'checking_intake_status',
          detail: status.completed ? 'complete' : 'incomplete',
        },
        {
          kind: 'action_complete',
          type: 'checking_intake_status',
          success: true,
          detail: status.completed ? 'complete' : 'incomplete',
        },
      ],
    }
  }

  /**
   * Bug 12 — voice equivalent of the text `flag_emergency` tool. Persists an
   * EmergencyEvent row and emits EMERGENCY_EVENTS.FLAGGED so EscalationService
   * pages the care team. Mirrors the ChatService.recordEmergencyEvent flow
   * (Bug 10 fix): awaited DB write, [SECURITY-CRITICAL] log on failure.
   */
  private async flagEmergency(
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<DispatchResult> {
    const situation =
      typeof args.emergency_situation === 'string' && args.emergency_situation.trim()
        ? args.emergency_situation.trim()
        : 'Emergency detected during voice session'
    try {
      await this.prisma.emergencyEvent.create({
        data: {
          userId: ctx.userId,
          sessionId: null, // voice doesn't pass chatSessionId into ToolContext
          prompt: '', // voice has no single "prompt" — situation captures it
          isEmergency: true,
          emergency_situation: situation,
        },
      })
      const payload: EmergencyFlaggedPayload = {
        userId: ctx.userId,
        sessionId: null,
        situation,
        source: 'voice-tool',
      }
      this.eventEmitter.emit(EMERGENCY_EVENTS.FLAGGED, payload)
    } catch (err) {
      this.logger.error(
        `[SECURITY-CRITICAL] voice emergency persistence failed userId=${ctx.userId} situation="${situation}" error=${
          (err as Error).message ?? 'unknown'
        }`,
      )
      // Do not throw — the LLM should still tell the patient "call 911"
      // verbally even if our audit write failed.
    }
    return {
      llmResponse: {
        flagged: true,
        emergency_situation: situation,
        message: 'Emergency flagged. Continue speaking to the patient with 911 guidance.',
      },
      events: [
        { kind: 'action', type: 'flag_emergency', detail: situation },
        { kind: 'action_complete', type: 'flag_emergency', success: true, detail: situation },
      ],
    }
  }
}

/**
 * Voice mirror of the text-chat symptom mapper — folds the loose
 * `symptoms: string[]` the model passes (e.g. ["dizziness","chest pain"])
 * into the structured-symptom booleans the rule engine consumes.
 */
// Negation prefixes that mean "patient denies this symptom" — must skip the
// mapper, not flip the flag on. Bug 2 fix.
const SYMPTOM_NEGATION_RE = /^(no|not|none|negative for|denies|denying|without|absent|no signs? of)\b/

export function mapVoiceSymptomsToFlags(raw: unknown): Partial<SessionSymptoms> | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const flags: Partial<SessionSymptoms> = {}
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const k = item.trim().toLowerCase()
    if (!k) continue
    // Bug 2 fix — see mapSymptomsArrayToFlags in journal-tools.ts for full
    // rationale. Without this, "no chest pain" flips chestPainOrDyspnea on
    // and fires a Level-2 emergency alert.
    if (SYMPTOM_NEGATION_RE.test(k)) continue
    // Bug 3 fix — collapse snake_case (e.g. 'face_swelling') to no-underscore
    // form so TIER_1_ANGIOEDEMA fires when the LLM echoes the schema key.
    const kn = k.replace(/_/g, '')
    if (kn === 'severeheadache' || kn.includes('severe headache')) flags.severeHeadache = true
    else if (kn === 'newonsetheadache' || kn.includes('new headache') || kn.includes('new-onset')) flags.newOnsetHeadache = true
    else if (kn === 'visualchanges' || kn.includes('vision') || kn.includes('blurr')) flags.visualChanges = true
    else if (kn === 'alteredmentalstatus' || kn.includes('confus') || kn.includes('mental status')) flags.alteredMentalStatus = true
    else if (kn === 'chestpainordyspnea' || kn.includes('chest pain') || kn.includes('chest tight') || kn.includes('dyspnea')) flags.chestPainOrDyspnea = true
    else if (kn === 'focalneurodeficit' || kn.includes('one side') || kn.includes('weakness')) flags.focalNeuroDeficit = true
    else if (kn === 'severeepigastricpain' || kn.includes('epigastric')) flags.severeEpigastricPain = true
    else if (kn === 'ruqpain' || kn.includes('ruq') || kn.includes('right upper')) flags.ruqPain = true
    else if (kn === 'edema' || kn === 'swelling') flags.edema = true
    else if (kn === 'dizziness' || kn.includes('dizzy') || kn.includes('lighthead')) flags.dizziness = true
    else if (kn === 'syncope' || kn.includes('faint') || kn.includes('pass out')) flags.syncope = true
    else if (kn === 'palpitations' || kn.includes('palpit') || kn.includes('flutter')) flags.palpitations = true
    else if (kn === 'legswelling' || kn.includes('leg swell') || kn.includes('ankle swell')) flags.legSwelling = true
    else if (kn === 'fatigue' || kn.includes('tired')) flags.fatigue = true
    else if (kn === 'shortnessofbreath' || kn.includes('short of breath') || kn.includes('breathless')) flags.shortnessOfBreath = true
    else if (kn === 'drycough' || kn.includes('dry cough')) flags.dryCough = true
    else if (kn === 'nsaiduse' || kn.includes('nsaid') || kn.includes('ibuprofen')) flags.nsaidUse = true
    else if (kn === 'faceswelling' || kn.includes('face swell')) flags.faceSwelling = true
    else if (kn === 'throattightness' || kn.includes('throat')) flags.throatTightness = true
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

// isoFromTzWallclock + tzOffsetMs moved to backend/src/common/datetime.ts so
// text chat's journal-tools dispatcher can share the same implementation.
// See Bug 18 — text chat was writing wallclock-as-UTC while voice used this
// helper correctly, causing My Readings to drift by the patient's UTC offset.
