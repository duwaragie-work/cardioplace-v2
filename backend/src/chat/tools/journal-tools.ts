/**
 * Gemini function-calling tool definitions for journal entry CRUD.
 * These call DailyJournalService directly (in-process, no HTTP round-trip).
 */

import { UnauthorizedException } from '@nestjs/common'
import { Type } from '@google/genai'
import type { FunctionDeclaration } from '@google/genai'
import { DailyJournalService } from '../../daily_journal/daily_journal.service.js'
import { isoFromTzWallclock } from '../../common/datetime.js'
import { normaliseWeightToKg } from '../../common/units.js'
import type { AlertEngineService } from '../../daily_journal/services/alert-engine.service.js'
import type { SessionSymptoms } from '../../daily_journal/engine/types.js'
import type { OcrService } from '../../ocr/ocr.service.js'
import { BpOcrFailure } from '../../ocr/ocr.service.js'
import type {
  AdherenceStatus,
  MedicationAdherenceService,
} from '../services/medication-adherence.service.js'
import type {
  StructuredSymptomKey,
  SymptomQuickLogService,
} from '../services/symptom-quick-log.service.js'
import type { IntakeStatusService } from '../../intake/intake-status.service.js'

/**
 * Bag of services the executor needs. Phase/27 — added to support
 * log_medication_adherence, log_symptom_quick, submit_bp_from_photo.
 * Original signature took only `journalService`; we kept the migration
 * additive by making the new services optional. Existing callers can
 * pass just the journal service and the new tools will fail fast with
 * a clear error.
 */
export interface JournalToolContext {
  journalService: DailyJournalService
  adherenceService?: MedicationAdherenceService
  symptomService?: SymptomQuickLogService
  ocrService?: OcrService
  alertEngine?: AlertEngineService
  /**
   * Read-only intake-completion lookup, surfaced as the `check_intake_status`
   * tool. Optional for legacy callers / tests; when omitted the tool reports
   * a clear "unavailable" message rather than crashing.
   */
  intakeStatusService?: IntakeStatusService
  /**
   * Called after every successful patient-data mutation (submit/update/delete
   * check-in, log adherence, log symptom) so the chat service can drop its
   * cached patient-context block — the next chat turn must see the freshly
   * saved reading / medication entry / symptom. Optional: when omitted (e.g.
   * legacy callers, tests), the cache simply ages out via TTL.
   */
  onPatientDataMutated?: (userId: string) => void
  /**
   * Bug 13 — session-scoped state used to enforce OCR verbal-confirmation.
   * `submit_bp_from_photo` sets `lastAt = Date.now(); userMessageSince = false`
   * on a successful parse. The chat streaming loop flips `userMessageSince`
   * to true on every new user turn. `submit_checkin` rejects when a recent
   * OCR result hasn't yet been re-confirmed by the patient (within
   * OCR_CONFIRMATION_WINDOW_MS). Mutable object so call sites can update in
   * place without re-threading the context.
   */
  ocrState?: { lastAt: number; userMessageSince: boolean }
  /**
   * Bug 18 — patient's IANA timezone, used by submit_checkin / update_checkin
   * to convert a wallclock `measurement_time` into a correct UTC instant for
   * `JournalEntry.measuredAt`. Optional for back-compat with legacy
   * call sites / tests; when omitted, the dispatcher falls back to
   * 'America/New_York' (mirrors the chat-service default).
   */
  timezone?: string
}

/** Bug 13 — how long a fresh OCR result blocks unconfirmed submit_checkin. */
export const OCR_CONFIRMATION_WINDOW_MS = 30_000

const MISSED_MED_REASONS = new Set([
  'FORGOT',
  'SIDE_EFFECTS',
  'RAN_OUT',
  'COST',
  'INTENTIONAL',
  'OTHER',
] as const)

// Synced 2026-05 to the full StructuredSymptomKey union (was stale at the
// original 9) so chat/voice quick-log can report every symptom the check-in
// checklist + engine support (Cluster 6/7/8).
const STRUCTURED_SYMPTOM_KEYS: ReadonlySet<StructuredSymptomKey> = new Set([
  'severeHeadache',
  'visualChanges',
  'alteredMentalStatus',
  'chestPainOrDyspnea',
  'focalNeuroDeficit',
  'severeEpigastricPain',
  'newOnsetHeadache',
  'ruqPain',
  'edema',
  'dizziness',
  'syncope',
  'palpitations',
  'legSwelling',
  'fatigue',
  'shortnessOfBreath',
  'dryCough',
  'nsaidUse',
  'faceSwelling',
  'throatTightness',
])

const ADHERENCE_STATUSES: ReadonlySet<AdherenceStatus> = new Set([
  'taken',
  'missed',
  'scheduled_later',
])

/**
 * Normalise a date string to YYYY-MM-DD. Accepts:
 *   - "2026-05-05" (already canonical)
 *   - "today" / "now" / "right now" / "just now" → today's date
 *   - "yesterday" → yesterday's date
 * Returns undefined for any other input — caller should treat that as
 * "patient didn't actually answer" rather than guessing.
 *
 * The system prompt also instructs the model to substitute "today" /
 * "yesterday" with the injected date; this is the defensive fallback for
 * when the model passes the word verbatim.
 */
export function normaliseDate(raw?: string): string | undefined {
  if (!raw) return undefined
  const s = raw.trim()
  if (!s) return undefined

  // Already canonical YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  const lower = s.toLowerCase()
  const now = new Date()
  if (lower === 'today' || lower === 'now' || lower === 'right now' || lower === 'just now') {
    return now.toISOString().slice(0, 10)
  }
  if (lower === 'yesterday') {
    const y = new Date(now)
    y.setUTCDate(y.getUTCDate() - 1)
    return y.toISOString().slice(0, 10)
  }
  return undefined
}

/**
 * Normalise a time string to HH:mm 24-hour format.
 * Handles: "13:00", "1:00 PM", "8:30 am", "2 PM", "14:15", "now", etc.
 * Returns undefined if the input can't be parsed.
 *
 * "now" / "right now" / "just now" / "current" / "current time" all resolve
 * to the current server-time HH:mm. The system prompt also instructs the
 * model to substitute "now" with the injected timestamp; this is the
 * defensive fallback for when the model passes the word verbatim.
 */
export function normaliseTime(raw?: string): string | undefined {
  if (!raw) return undefined
  const s = raw.trim()
  const lower = s.toLowerCase()

  // "now" / "right now" / "just now" / "current" / "current time"
  if (
    lower === 'now' ||
    lower === 'right now' ||
    lower === 'just now' ||
    lower === 'current' ||
    lower === 'current time'
  ) {
    const d = new Date()
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

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

const MEASUREMENT_CONDITION_KEYS = [
  'noCaffeine',
  'noSmoking',
  'noExercise',
  'bladderEmpty',
  'seatedQuietly',
  'posturalSupport',
  'notTalking',
  'cuffOnBareArm',
] as const

/**
 * Filter the model's measurement_conditions object down to known keys with
 * boolean values. Skips unanswered keys entirely (rather than defaulting to
 * false) so the JSON column reflects only what the patient confirmed.
 * Returns undefined when nothing was answered so the column stays NULL.
 */
export function sanitiseMeasurementConditions(
  raw: unknown,
): Record<string, boolean> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, boolean> = {}
  for (const key of MEASUREMENT_CONDITION_KEYS) {
    const v = (raw as Record<string, unknown>)[key]
    if (typeof v === 'boolean') out[key] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Map the model's loose `missed_medications` array (snake_case keys, just
 * drugName + reason + optional dose count) to the camelCase shape the
 * DailyJournalService expects on its DTO. The service itself does the
 * Prisma resolution (drugName → medicationId, drug-class lookup, AS_NEEDED
 * filter, drop-unmatched) so this helper is purely a key-rename + reason
 * whitelist.
 *
 * Returns undefined when nothing valid came in so the adherence rule
 * falls back to the medicationTaken rollup.
 */
export function normaliseMissedMedications(
  raw: unknown,
):
  | Array<{ drugName: string; reason: string; missedDoses: number }>
  | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: Array<{ drugName: string; reason: string; missedDoses: number }> = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const drugName =
      typeof r.drug_name === 'string'
        ? r.drug_name.trim()
        : typeof r.drugName === 'string'
          ? r.drugName.trim()
          : ''
    if (!drugName) continue
    const reasonRaw =
      typeof r.reason === 'string' ? r.reason.trim().toUpperCase() : ''
    if (!MISSED_MED_REASONS.has(reasonRaw as never)) continue
    const dosesRaw =
      typeof r.missed_doses === 'number'
        ? r.missed_doses
        : typeof r.missedDoses === 'number'
          ? r.missedDoses
          : 1
    const missedDoses = Math.min(10, Math.max(1, Math.round(dosesRaw)))
    out.push({ drugName, reason: reasonRaw, missedDoses })
  }
  return out.length > 0 ? out : undefined
}

/**
 * Normalise the model's `position` argument to one of the v2 enum values.
 * Returns undefined if the input doesn't match — caller should treat that as
 * "patient didn't specify" rather than guessing.
 */
export function normalisePosition(raw: unknown): 'SITTING' | 'STANDING' | 'LYING' | undefined {
  if (typeof raw !== 'string') return undefined
  const upper = raw.trim().toUpperCase()
  if (upper === 'SITTING' || upper === 'STANDING' || upper === 'LYING') return upper
  // Common synonyms the model might emit
  if (upper === 'SAT' || upper === 'SEATED') return 'SITTING'
  if (upper === 'STAND' || upper === 'STOOD') return 'STANDING'
  if (upper === 'LYING DOWN' || upper === 'LAYING' || upper === 'LAID') return 'LYING'
  return undefined
}

// ── Intake-incomplete error detection ───────────────────────────────────────
// DailyJournalService.create throws ForbiddenException({ message:
// 'clinical-intake-required', reason: ... }) when the user has no
// PatientProfile row. NestJS surfaces that as
//   err.status === 403, err.response = { message, reason }, err.message ≈ 'Forbidden'
// We catch it here so the LLM receives a structured INTAKE_INCOMPLETE
// response (with the /clinical-intake URL) instead of an opaque
// "Failed to save check-in" string. log_medication_adherence and
// log_symptom_quick funnel through journal.create too — they hit the
// same gate.
export function isIntakeIncompleteError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as {
    status?: number
    name?: string
    message?: string
    response?: { message?: string }
  }
  const msg = e.response?.message ?? e.message ?? ''
  return (
    (e.status === 403 || e.name === 'ForbiddenException') &&
    typeof msg === 'string' &&
    msg.includes('clinical-intake-required')
  )
}

function intakeIncompleteResponse(verb: 'saved' | 'logged'): string {
  return JSON.stringify({
    [verb]: false,
    reason: 'INTAKE_INCOMPLETE',
    intake_url: '/clinical-intake',
    message:
      "Before I can save a check-in I need you to complete your one-time intake form. " +
      "It only takes a few minutes — please go to /clinical-intake and come back when you're done.",
  })
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
        '2) Did they take their medication? (must be a real yes/no from the patient). ' +
        '   If they say "no" or "I forgot some", ASK WHICH medications they missed and why ' +
        '   (forgot / side effects / ran out / cost / intentional / other) — pass through `missed_medications`. ' +
        '   Do NOT ask about AS_NEEDED (PRN) medications — those aren\'t on a fixed daily schedule. ' +
        '3) Any symptoms? (must be a real answer from the patient — even "none" counts), ' +
        '4) Their weight (they can skip), ' +
        '5) Measurement context (the B1 pre-measurement checklist) — at minimum confirm caffeine + bare arm + ' +
        '   seated quietly. Pass partials through `measurement_conditions`; omit any flag the patient didn\'t answer. ' +
        'If ANY of fields 1–3 have not been explicitly answered by the patient in the conversation, ' +
        'DO NOT call this tool — ask the missing question first. ' +
        'After collecting everything, you must summarise and get the patient to confirm before calling.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          entry_date: {
            type: Type.STRING,
            description:
              'Date the BP was measured in YYYY-MM-DD format. ' +
              'When the patient says "today" / "now" / "just now", you may pass the literal ' +
              'string "today" — the system will substitute the injected date. For "yesterday" ' +
              'either pass "yesterday" or compute the date yourself. NEVER skip asking the ' +
              'patient this question; NEVER assume today without confirming.',
          },
          measurement_time: {
            type: Type.STRING,
            description:
              'Time the BP was measured in HH:mm 24-hour format (e.g. "08:30", "14:15"). ' +
              'When the patient says "now", "right now", "just now", or "I just took it", ' +
              'you may pass the literal string "now" — the system will substitute the current ' +
              'time. NEVER skip asking the patient this question; NEVER guess a time.',
          },
          systolic_bp: { type: Type.NUMBER, description: 'Systolic (top number, 60–250). Must come from the patient.' },
          diastolic_bp: { type: Type.NUMBER, description: 'Diastolic (bottom number, 40–150). Must come from the patient.' },
          pulse: { type: Type.NUMBER, description: 'Pulse / heart rate in bpm (30–220). Optional — omit if not measured.' },
          position: { type: Type.STRING, description: 'Position during measurement: SITTING, STANDING, or LYING. Optional — omit if not asked.' },
          medication_taken: { type: Type.BOOLEAN, description: 'Did the patient take their meds? Must be explicitly answered by the patient.' },
          medication_scheduled_later: { type: Type.BOOLEAN, description: 'Set to true when the patient says their medication is "not due yet" / scheduled for later. Treats the dose as a neutral state (no adherence alert) instead of "missed".' },
          weight: { type: Type.NUMBER, description: 'Weight as a number — pass whatever value the patient said. Omit if skipped. Set weight_unit to specify lbs or kg.' },
          weight_unit: { type: Type.STRING, description: 'Unit for `weight`: "LBS" or "KG". Use whichever unit the patient actually said — do NOT convert in your head. Defaults to LBS when omitted (back-compat).' },
          symptoms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Legacy freeform symptom list in English. Empty array [] if patient said none. Prefer the structured booleans below for the 9 known clinical symptoms.' },
          severe_headache: { type: Type.BOOLEAN, description: 'Patient reports a severe headache (Level-2 trigger). Default false.' },
          visual_changes: { type: Type.BOOLEAN, description: 'Patient reports visual changes / blurred / double vision (Level-2 trigger). Default false.' },
          altered_mental_status: { type: Type.BOOLEAN, description: 'Patient reports confusion, drowsiness, slurred speech, altered mental status (Level-2 trigger). Default false.' },
          chest_pain_or_dyspnea: { type: Type.BOOLEAN, description: 'Patient reports chest pain or shortness of breath (Level-2 trigger). Default false.' },
          focal_neuro_deficit: { type: Type.BOOLEAN, description: 'Patient reports one-sided weakness, numbness, facial droop, or other focal neuro deficit (Level-2 trigger). Default false.' },
          severe_epigastric_pain: { type: Type.BOOLEAN, description: 'Patient reports severe upper-abdominal pain (Level-2 trigger). Default false.' },
          new_onset_headache: { type: Type.BOOLEAN, description: 'Pregnancy-only: new-onset headache. Set only when patient is pregnant. Default false.' },
          ruq_pain: { type: Type.BOOLEAN, description: 'Pregnancy-only: right-upper-quadrant abdominal pain. Set only when patient is pregnant. Default false.' },
          edema: { type: Type.BOOLEAN, description: 'Pregnancy-only: facial / hand / leg swelling. Set only when patient is pregnant. Default false.' },
          other_symptoms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Patient-reported "anything else" symptoms not covered by the 9 structured booleans above. English. Optional.' },
          measurement_conditions: {
            type: Type.OBJECT,
            description:
              'B1 pre-measurement checklist. Each property is a boolean — true = patient confirmed they followed it, false = they explicitly said they didn\'t, omit = not asked. Don\'t default unanswered flags to false.',
            properties: {
              noCaffeine: { type: Type.BOOLEAN, description: 'No caffeine in the last ~30 minutes.' },
              noSmoking: { type: Type.BOOLEAN, description: 'No smoking in the last ~30 minutes.' },
              noExercise: { type: Type.BOOLEAN, description: 'No exercise in the last ~30 minutes.' },
              bladderEmpty: { type: Type.BOOLEAN, description: 'Bladder empty before measuring.' },
              seatedQuietly: { type: Type.BOOLEAN, description: 'Seated quietly for at least 5 minutes before measuring.' },
              posturalSupport: { type: Type.BOOLEAN, description: 'Back supported, feet flat on floor, arm supported at heart level.' },
              notTalking: { type: Type.BOOLEAN, description: 'Not talking during measurement.' },
              cuffOnBareArm: { type: Type.BOOLEAN, description: 'Cuff placed on a bare arm (no clothing under the cuff).' },
            },
          },
          missed_medications: {
            type: Type.ARRAY,
            description:
              'Per-medication miss detail. Use ONLY when patient explicitly said they missed specific medications. ' +
              'Each item: drug_name (canonical name from the patient\'s med list, e.g. "Lisinopril"), ' +
              'reason (one of FORGOT / SIDE_EFFECTS / RAN_OUT / COST / INTENTIONAL / OTHER), ' +
              'missed_doses (1–10 — how many doses they missed today). ' +
              'AS_NEEDED (PRN) meds will be skipped server-side; you don\'t need to filter them yourself. ' +
              'Leave empty / omit when patient said they took everything OR said "I missed some" without naming which.',
            items: {
              type: Type.OBJECT,
              properties: {
                drug_name: { type: Type.STRING, description: 'Drug name as it appears in the patient\'s medication list.' },
                reason: { type: Type.STRING, description: 'One of: FORGOT, SIDE_EFFECTS, RAN_OUT, COST, INTENTIONAL, OTHER.' },
                missed_doses: { type: Type.NUMBER, description: 'Number of doses missed today (1–10). Default 1 if patient didn\'t specify.' },
              },
              required: ['drug_name', 'reason'],
            },
          },
          notes: { type: Type.STRING, description: 'Extra notes in English. Omit if none.' },
          session_id: {
            type: Type.STRING,
            description:
              'Optional session-grouping UUID. When recording MULTIPLE readings as one measurement session ' +
              '(AFib patients always; or anyone you asked to take ≥2 readings), generate ONE UUID at the start ' +
              'of the session and pass the SAME value on every submit_checkin call in that session. To ADD a ' +
              'reading to an EXISTING session (e.g. AFib patient returns to add a 4th reading after the 5-min ' +
              'proximity window expired), first call get_recent_readings, find an entry from that session and ' +
              'reuse its sessionId on the new submit_checkin. Backend groups same-session readings for alert ' +
              'averaging even when they span more than 5 minutes. Omit for one-off single-reading check-ins.',
          },
        },
        required: ['entry_date', 'measurement_time', 'systolic_bp', 'diastolic_bp', 'medication_taken', 'symptoms'],
      },
    },
    {
      name: 'get_recent_readings',
      description:
        "Retrieve the patient's recent blood pressure readings. " +
        'Use when the patient asks about past readings, trends, or before updating/deleting. ' +
        'Bug 21c — triggers on ANY patient phrasing meaning "show me my past readings" — ' +
        'e.g. "give me my readings", "show me my readings", "show my readings", ' +
        '"show me my BP", "give me my BP", "what\'s my BP history", "list my readings", ' +
        '"list my check-ins", "what are my readings", "my history", "my BP history", ' +
        '"my check-ins", "my measurements", "my recent BPs", "my last few readings", ' +
        '"show me my last reading", "what was my last reading", ' +
        '"what did I record last week". Also use before update_checkin / delete_checkin ' +
        'when the patient hasn\'t specified which entry.',
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
        'TARGET RESOLUTION: If the patient uses a natural-language reference ' +
        "(e.g. 'update the last reading', 'change my most recent BP', 'fix the one I just took'), " +
        'DO NOT ask them for the date and time. Call get_recent_readings first, identify the newest ' +
        'entry yourself, summarise the proposed change to the patient ' +
        "(\"Your most recent reading is 138/85 at 8:30 AM on June 1 — should I change the systolic to 142?\"), " +
        "and only on explicit 'yes' call this tool with that entry's date+time (and optionally entry_id). " +
        'If the patient gave a specific date and/or time, pass those through instead. Either way, always ' +
        'summarise and get explicit yes before calling. Only include fields that need to change.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          entry_date: { type: Type.STRING, description: 'Date of the reading to update (YYYY-MM-DD).' },
          original_time: { type: Type.STRING, description: 'The measurement time of the reading to update (HH:mm 24-hour format, e.g. "00:30", "12:10").' },
          entry_id: { type: Type.STRING, description: 'Entry ID from get_recent_readings (optional, used if available).' },
          measurement_time: { type: Type.STRING, description: 'New measurement time in HH:mm 24-hour format.' },
          systolic_bp: { type: Type.NUMBER, description: 'New systolic (top number) BP (60–250).' },
          diastolic_bp: { type: Type.NUMBER, description: 'New diastolic (bottom number) BP (40–150).' },
          pulse: { type: Type.NUMBER, description: 'New pulse / heart rate (30–220).' },
          position: { type: Type.STRING, description: 'New position: SITTING, STANDING, or LYING.' },
          medication_taken: { type: Type.BOOLEAN, description: 'New medication status.' },
          medication_scheduled_later: { type: Type.BOOLEAN, description: 'Set true if patient now says the dose is "not due yet" / scheduled for later (neutralises the missed flag).' },
          weight: { type: Type.NUMBER, description: 'New weight value. Set weight_unit to specify lbs or kg.' },
          weight_unit: { type: Type.STRING, description: 'Unit for `weight`: "LBS" or "KG". Use whichever unit the patient said. Defaults to LBS.' },
          symptoms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'New legacy freeform symptom list. ALWAYS in English. Prefer structured booleans below for the 9 known clinical symptoms.' },
          severe_headache: { type: Type.BOOLEAN, description: 'New severe-headache flag.' },
          visual_changes: { type: Type.BOOLEAN, description: 'New visual-changes flag.' },
          altered_mental_status: { type: Type.BOOLEAN, description: 'New altered-mental-status flag.' },
          chest_pain_or_dyspnea: { type: Type.BOOLEAN, description: 'New chest-pain / shortness-of-breath flag.' },
          focal_neuro_deficit: { type: Type.BOOLEAN, description: 'New focal-neuro-deficit flag.' },
          severe_epigastric_pain: { type: Type.BOOLEAN, description: 'New severe-epigastric-pain flag.' },
          new_onset_headache: { type: Type.BOOLEAN, description: 'New new-onset-headache flag (pregnancy-only).' },
          ruq_pain: { type: Type.BOOLEAN, description: 'New RUQ-pain flag (pregnancy-only).' },
          edema: { type: Type.BOOLEAN, description: 'New edema flag (pregnancy-only).' },
          other_symptoms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'New "anything else" symptom list. English.' },
          notes: { type: Type.STRING, description: 'New notes. ALWAYS in English regardless of conversation language.' },
          session_id: {
            type: Type.STRING,
            description:
              'Optional. Move this reading into the given session-grouping UUID. Most edits should LEAVE THIS ' +
              'OUT — the entry already has a session_id assigned at record time and changing it would split or ' +
              'merge sessions for averaging. Only set when the patient explicitly asks to move a reading to a ' +
              'different session.',
          },
        },
        required: ['entry_date', 'original_time'],
      },
    },
    {
      name: 'delete_checkin',
      description:
        'Delete a blood pressure reading. ' +
        'TARGET RESOLUTION: If the patient uses a natural-language reference ' +
        "(e.g. 'delete the last reading', 'remove my most recent BP', 'delete the one I just took'), " +
        'DO NOT ask them for the date and time. Call get_recent_readings first, identify the newest ' +
        'entry yourself, summarise it for the patient ' +
        "(\"Your most recent reading is 138/85 at 8:30 AM on June 1 — should I delete it?\"), " +
        "and only on explicit 'yes' call this tool with that entry's date+time (and optionally entry_id). " +
        'If the patient gave a specific date and/or time, pass those through instead. Either way, always ' +
        'summarise and get explicit yes before deleting.',
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
      name: 'log_medication_adherence',
      description:
        'Quick-log a single medication as taken / missed / scheduled-later WITHOUT a full check-in. ' +
        'Call this when the patient mentions one specific medication ("I took my Lisinopril this morning", ' +
        '"Skip my Carvedilol, I\'ll take it tonight", "I missed my Atorvastatin yesterday"). ' +
        'Do NOT call this for full check-ins (use submit_checkin) or generic "I took my meds" without a drug name.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          drug_name: { type: Type.STRING, description: 'Drug name as the patient said it (e.g. "Lisinopril"). Will be matched case-insensitively against the patient\'s active medications.' },
          medication_id: { type: Type.STRING, description: 'PatientMedication.id if known (e.g. from chat context). Optional — drug_name is enough.' },
          status: { type: Type.STRING, description: 'One of: "taken", "missed", "scheduled_later".' },
          missed_doses: { type: Type.NUMBER, description: 'Number of doses missed (only relevant when status=missed). Defaults to 1.' },
          reason: { type: Type.STRING, description: 'Why the dose was missed: FORGOT, SIDE_EFFECTS, RAN_OUT, COST, INTENTIONAL, OTHER. Only relevant when status=missed.' },
        },
        required: ['status'],
      },
    },
    {
      name: 'log_symptom_quick',
      description:
        'Quick-log a single structured symptom RIGHT NOW without requiring a BP measurement. ' +
        'Use when the patient reports a symptom in the present tense without offering BP numbers ' +
        '("I have severe headache right now", "I feel dizzy and confused"). ' +
        'This persists a sparse JournalEntry that fires the symptom-override rule — the patient\'s ' +
        'care team is notified immediately. Do NOT call for past-tense symptoms or during a full check-in.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          symptom: { type: Type.STRING, description: 'One structured symptom key. Emergency / Level-2: severeHeadache, visualChanges, alteredMentalStatus, chestPainOrDyspnea, focalNeuroDeficit, severeEpigastricPain. Pregnancy-only (fire only if patient is pregnant): newOnsetHeadache, ruqPain, edema. Cardiac signals: dizziness, syncope, palpitations, legSwelling. Medication side-effects: fatigue, shortnessOfBreath, dryCough, nsaidUse. Airway emergency (Tier 1, any patient): faceSwelling, throatTightness.' },
          notes: { type: Type.STRING, description: 'Optional patient phrasing of the symptom (e.g. "throbbing pain behind my eyes for an hour"). Stored as otherSymptoms[0].' },
        },
        required: ['symptom'],
      },
    },
    {
      name: 'submit_bp_from_photo',
      description:
        'Run OCR on a cuff-display photo the patient just sent in chat. ' +
        'Returns the extracted SBP/DBP/pulse with a confidence score so you can verbally confirm ' +
        'with the patient before saving. This tool does NOT persist anything — after the patient ' +
        'confirms, call submit_checkin with the returned numbers. Decline politely if the result ' +
        'has confidence below 0.6 or returns no numbers (ask the patient to type the values instead).',
      parameters: {
        type: Type.OBJECT,
        properties: {
          image_base64: { type: Type.STRING, description: 'Base64-encoded photo of the cuff display, no data: prefix.' },
          mime_type: { type: Type.STRING, description: 'Image MIME type — one of image/jpeg, image/png, image/webp, image/heic.' },
        },
        required: ['image_base64', 'mime_type'],
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
    {
      name: 'evaluate_reading',
      description:
        "Ask the patient's personalised rule engine what a BP / HR reading means FOR THIS PATIENT. " +
        'Returns the canonical patient-tier alert message signed off by the clinical director ' +
        '(or null if the reading is within their targets). ' +
        "Call this whenever the patient asks 'what does X over Y mean for me', 'is N safe for me', " +
        "or wants an interpretation of a specific reading. " +
        'Do NOT use this to log a check-in — use submit_checkin for that. ' +
        'Nothing is persisted; the engine only computes the verdict.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          systolic_bp: { type: Type.NUMBER, description: 'Systolic BP in mmHg.' },
          diastolic_bp: { type: Type.NUMBER, description: 'Diastolic BP in mmHg.' },
          heart_rate: { type: Type.NUMBER, description: 'Pulse in bpm (optional).' },
          symptoms: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'Optional symptoms the patient mentioned alongside the reading. ' +
              'Use the same structured-symptom keys as log_symptom_quick ' +
              '(e.g. dizziness, chestPainOrDyspnea, palpitations, severeHeadache, edema, legSwelling).',
          },
        },
        required: ['systolic_bp', 'diastolic_bp'],
      },
    },
    {
      name: 'finalize_checkin',
      description:
        'Finalise a SINGLE-reading session — tells the rule engine to evaluate the just-saved ' +
        'entry NOW even though only one reading was taken. The engine normally requires ≥2 ' +
        'readings averaged in the same session before non-emergency Stage C rules (BP-high, ' +
        'sbp-low, HR rules) fire; this flips the singleReadingFinalized flag so the gate is ' +
        'bypassed for that one entry. ' +
        'WHEN TO CALL: only after a successful submit_checkin AND the patient has explicitly ' +
        "confirmed they do not want to take a second reading (e.g. they said \"just save this one\" " +
        'or "I don\'t want to take another"). Do NOT call for AFib patients — they need at ' +
        'least 3 readings; call submit_checkin two more times instead. ' +
        'Required arg: entry_id from the previous submit_checkin\'s data.id field.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          entry_id: {
            type: Type.STRING,
            description:
              'Entry id returned in data.id from the most recent submit_checkin call this turn.',
          },
        },
        required: ['entry_id'],
      },
    },
    {
      name: 'check_intake_status',
      description:
        "Check whether the patient has completed their one-time clinical intake form. " +
        "Call this BEFORE the first submit_checkin / update_checkin / delete_checkin / " +
        "finalize_checkin / log_medication_adherence / log_symptom_quick in a conversation. " +
        "If completed=false, do NOT call any of those tools — the backend will 403 and the " +
        "patient cannot save readings until intake is done. Route them to intake_url instead. " +
        "Read-only; nothing is persisted.",
      parameters: {
        type: Type.OBJECT,
        properties: {},
        required: [],
      },
    },
  ]
}

// ── Tool executor ───────────────────────────────────────────────────────────

/**
 * Execute a tool the model called. Accepts either the new context-object
 * shape (preferred) or the legacy positional `journalService` for callers
 * that haven't migrated yet. New tools (adherence, symptom-quick, photo)
 * require the context shape — they return a clear failure JSON when called
 * via the legacy path.
 */
export async function executeJournalTool(
  name: string,
  args: Record<string, any>,
  ctxOrJournal: JournalToolContext | DailyJournalService,
  userId: string,
): Promise<string> {
  // Fail-loud multi-tenant guard: every tool call MUST run on behalf of an
  // authenticated patient. If a future refactor ever drops JwtAuthGuard or
  // forgets to thread userId from req.user.id, we want to abort here rather
  // than silently issue unscoped Prisma queries.
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new UnauthorizedException(
      'Tool dispatch requires an authenticated patient (userId is empty).',
    )
  }
  const ctx: JournalToolContext =
    'journalService' in ctxOrJournal
      ? ctxOrJournal
      : { journalService: ctxOrJournal as DailyJournalService }
  const journalService = ctx.journalService
  switch (name) {
    case 'submit_checkin': {
      // Bug 13 — OCR verbal-confirmation guard. submit_bp_from_photo stamps
      // ctx.ocrState.lastAt + clears userMessageSince. The streaming loop
      // flips userMessageSince=true on every new user turn. If we reach
      // submit_checkin within OCR_CONFIRMATION_WINDOW_MS and there's been
      // no user message since the OCR, the LLM is trying to save OCR
      // values without re-reading them back — refuse to write to the DB.
      if (
        ctx.ocrState
        && !ctx.ocrState.userMessageSince
        && Date.now() - ctx.ocrState.lastAt < OCR_CONFIRMATION_WINDOW_MS
      ) {
        return JSON.stringify({
          saved: false,
          reason: 'OCR_UNCONFIRMED',
          message:
            'Please read the OCR-parsed BP back to the patient and get their explicit verbal confirmation before saving.',
        })
      }

      // Guard: reject if required fields are missing or have placeholder values.
      // This prevents the model from saving before asking all required questions.
      const missing: string[] = []
      if (!args.entry_date || typeof args.entry_date !== 'string' || !args.entry_date.trim()) {
        missing.push('entry_date (ask: "What date is this reading for?")')
      }
      if (!args.measurement_time || typeof args.measurement_time !== 'string' || !args.measurement_time.trim()) {
        missing.push('measurement_time (ask: "What time was this reading taken?")')
      }
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
      // Resolve the date — accepts "today" / "yesterday" verbatim too in case
      // the model didn't substitute the injected timestamp. Falls back to
      // today's UTC date only if the gate above somehow let an empty value
      // through (defensive — required field is supposed to block this).
      const entryDate =
        normaliseDate(args.entry_date) ?? new Date().toISOString().slice(0, 10)
      // Block future dates
      const today = new Date().toISOString().slice(0, 10)
      if (entryDate > today) {
        return JSON.stringify({
          saved: false,
          message: `Cannot save a check-in for a future date (${entryDate}). Check-ins can only be recorded for today or past dates. Please use today's date.`,
        })
      }
      // Bug 14d — mirror the BP check-in form's 30-day stale-reading limit so
      // backfilling old readings doesn't skew session-averaging windows + the
      // pre-day-3 personalization gate. Without this, a patient could ask
      // the chatbot to log a reading from 6 weeks ago (form would reject)
      // and land it in the rule-engine trend.
      const STALE_READING_MS = 30 * 24 * 60 * 60 * 1000
      const entryAgeMs = Date.now() - new Date(`${entryDate}T12:00:00.000Z`).getTime()
      if (entryAgeMs > STALE_READING_MS) {
        return JSON.stringify({
          saved: false,
          reason: 'STALE_READING',
          message: `Cannot save a reading older than 30 days (${entryDate}). The BP check-in form has the same 30-day limit. Ask the patient if they meant a more recent date.`,
        })
      }
      try {
        const time = normaliseTime(args.measurement_time) ?? new Date().toISOString().slice(11, 16)
        // Bug 18 — was `new Date(\`${entryDate}T${time}:00.000Z\`).toISOString()`
        // which treated the patient's wallclock as UTC. A patient in IST saying
        // "3:32 PM" got stored as 15:32Z, then My Readings rendered the UTC
        // instant in client-local (+5:30) → "9:02 PM". Voice already used
        // this helper; text chat now matches. Falls back to 'America/New_York'
        // only when ctx.timezone is unset (legacy callers / older tests).
        const measuredAt = isoFromTzWallclock(
          entryDate,
          time,
          ctx.timezone ?? 'America/New_York',
        )
        // Position whitelist — Gemini may return lowercase or unexpected values.
        const position = normalisePosition(args.position)
        // B1 pre-measurement checklist — pass through only the booleans the
        // patient actually answered. Don't default unanswered flags to false.
        const measurementConditions = sanitiseMeasurementConditions(args.measurement_conditions)
        // Per-medication miss detail — pass the loose shape through; the
        // DailyJournalService does the Prisma resolution (drugName →
        // medicationId), filters AS_NEEDED, and drops unmatched drugs.
        const missedMedications = normaliseMissedMedications(args.missed_medications)
        // Bug 16A — defence-in-depth invariant. The LLM occasionally passes
        // contradictory state: medication_taken=true alongside a non-empty
        // missed_medications array. Normalise here so the DB, rule engine,
        // and downstream UI all see consistent values. Without this, the
        // patient's check-in CARD shows "All taken" while the missed-med
        // list silently exists in another column.
        const effectiveMedicationTaken =
          missedMedications && missedMedications.length > 0
            ? false
            : args.medication_taken
        // Defence-in-depth symptom mapping: even when the LLM puts the
        // patient's symptom only in the freeform `args.symptoms` array
        // (e.g. ["chest pain"]) and forgets to set the matching structured
        // boolean (e.g. `chest_pain_or_dyspnea: true`), the same keyword
        // mapper used by `evaluate_reading` catches it here and flips the
        // boolean ON. Without this, the rule engine's symptom-override
        // Stage A never fires on chest pain spoken in chat — clinical-
        // safety bug, not just a UI nit. The freeform array is still
        // preserved (`symptoms` and `otherSymptoms` below) so the chart
        // keeps the patient's exact words.
        const mappedFromFreeform = mapSymptomsArrayToFlags(args.symptoms) ?? {}
        const result = await journalService.create(userId, {
          measuredAt,
          systolicBP: args.systolic_bp,
          diastolicBP: args.diastolic_bp,
          pulse: args.pulse ?? null,
          position: position ?? undefined,
          measurementConditions,
          medicationTaken: effectiveMedicationTaken,
          medicationScheduledLater: args.medication_scheduled_later === true,
          missedMedications,
          // Bug 19 + kg/lbs follow-up — `weight` may arrive in lbs OR kg
          // depending on the new `weight_unit` arg. Backend always
          // persists kg. normaliseWeightToKg handles the branch (default
          // = LBS when weight_unit omitted, for back-compat). Returns 0
          // for invalid input so we omit the field.
          weight: (() => {
            const kg = normaliseWeightToKg(
              typeof args.weight === 'number' ? args.weight : 0,
              typeof args.weight_unit === 'string' ? args.weight_unit : undefined,
            )
            return kg > 0 ? kg : undefined
          })(),
          symptoms: args.symptoms ?? [],
          // 9 structured Level-2 symptom booleans — explicit LLM arg wins;
          // otherwise pick up what the keyword mapper extracted from the
          // freeform array. Default `false` when neither source set it so
          // the rule engine sees a clean fully-populated entry.
          severeHeadache: args.severe_headache === true || mappedFromFreeform.severeHeadache === true,
          visualChanges: args.visual_changes === true || mappedFromFreeform.visualChanges === true,
          alteredMentalStatus: args.altered_mental_status === true || mappedFromFreeform.alteredMentalStatus === true,
          chestPainOrDyspnea: args.chest_pain_or_dyspnea === true || mappedFromFreeform.chestPainOrDyspnea === true,
          focalNeuroDeficit: args.focal_neuro_deficit === true || mappedFromFreeform.focalNeuroDeficit === true,
          severeEpigastricPain: args.severe_epigastric_pain === true || mappedFromFreeform.severeEpigastricPain === true,
          newOnsetHeadache: args.new_onset_headache === true || mappedFromFreeform.newOnsetHeadache === true,
          ruqPain: args.ruq_pain === true || mappedFromFreeform.ruqPain === true,
          edema: args.edema === true || mappedFromFreeform.edema === true,
          // Cluster-6 / Cluster-7 / Cluster-8 keys aren't on the text tool's
          // arg schema, but the rule engine consumes them and the keyword
          // mapper recognises them in freeform text. Pass them through when
          // the mapper detected one so the engine's downstream rules
          // (brady-symptomatic, palpitations, HF-decomp, ACE-angioedema, etc.)
          // can still fire.
          dizziness: mappedFromFreeform.dizziness === true,
          syncope: mappedFromFreeform.syncope === true,
          palpitations: mappedFromFreeform.palpitations === true,
          legSwelling: mappedFromFreeform.legSwelling === true,
          fatigue: mappedFromFreeform.fatigue === true,
          shortnessOfBreath: mappedFromFreeform.shortnessOfBreath === true,
          dryCough: mappedFromFreeform.dryCough === true,
          nsaidUse: mappedFromFreeform.nsaidUse === true,
          faceSwelling: mappedFromFreeform.faceSwelling === true,
          throatTightness: mappedFromFreeform.throatTightness === true,
          otherSymptoms: Array.isArray(args.other_symptoms) ? args.other_symptoms : undefined,
          notes: args.notes ?? '',
          sessionId:
            typeof args.session_id === 'string' && args.session_id.trim() ? args.session_id.trim() : undefined,
        } as any)
        ctx.onPatientDataMutated?.(userId)
        return JSON.stringify({ saved: true, message: 'Check-in saved successfully.', data: result.data })
      } catch (err: any) {
        if (isIntakeIncompleteError(err)) return intakeIncompleteResponse('saved')
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
        // ── LLM privacy boundary ─────────────────────────────────────────
        // This projection is the privacy boundary between the patient's
        // JournalEntry row (which carries internal columns like userId,
        // source, sourceMetadata, createdAt, updatedAt) and the narrow JSON
        // the LLM tool-call receives. NEVER widen this to forward internal
        // fields — the LLM might quote them back to the patient, and a new
        // column added to the Prisma schema must not auto-flow to the model.
        // Allow-list exception: `session_id` is intentionally exposed so the
        // LLM can thread an existing session through a subsequent
        // submit_checkin (multi-reading add-to-session flow for AFib and
        // other clinically-grouped sessions). It is a grouping label, never
        // a security boundary — composite { id, userId } scoping on every
        // mutation still prevents cross-tenant leak. Mirror voice
        // voice-tools.service.ts:getRecentReadings if changing the shape.
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
            session_id: e.sessionId ?? null,
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
          // Bug 18 — same wallclock-as-UTC fix as submit_checkin above.
          dto.measuredAt = isoFromTzWallclock(
            d,
            t,
            ctx.timezone ?? 'America/New_York',
          )
        }
        if (args.systolic_bp != null) dto.systolicBP = args.systolic_bp
        if (args.diastolic_bp != null) dto.diastolicBP = args.diastolic_bp
        if (args.pulse != null) dto.pulse = args.pulse
        const updPosition = normalisePosition(args.position)
        if (updPosition) dto.position = updPosition
        if (args.medication_taken != null) dto.medicationTaken = args.medication_taken
        if (args.medication_scheduled_later != null) dto.medicationScheduledLater = args.medication_scheduled_later === true
        // Bug 19 + kg/lbs follow-up — same normalisation as submit_checkin.
        if (typeof args.weight === 'number' && args.weight > 0) {
          const kg = normaliseWeightToKg(
            args.weight,
            typeof args.weight_unit === 'string' ? args.weight_unit : undefined,
          )
          if (kg > 0) dto.weight = kg
        }
        if (args.symptoms != null) dto.symptoms = args.symptoms
        // Structured Level-2 booleans (only set what the model explicitly sent)
        if (args.severe_headache != null) dto.severeHeadache = args.severe_headache === true
        if (args.visual_changes != null) dto.visualChanges = args.visual_changes === true
        if (args.altered_mental_status != null) dto.alteredMentalStatus = args.altered_mental_status === true
        if (args.chest_pain_or_dyspnea != null) dto.chestPainOrDyspnea = args.chest_pain_or_dyspnea === true
        if (args.focal_neuro_deficit != null) dto.focalNeuroDeficit = args.focal_neuro_deficit === true
        if (args.severe_epigastric_pain != null) dto.severeEpigastricPain = args.severe_epigastric_pain === true
        if (args.new_onset_headache != null) dto.newOnsetHeadache = args.new_onset_headache === true
        if (args.ruq_pain != null) dto.ruqPain = args.ruq_pain === true
        if (args.edema != null) dto.edema = args.edema === true
        if (Array.isArray(args.other_symptoms)) dto.otherSymptoms = args.other_symptoms
        if (args.notes != null) dto.notes = args.notes
        if (typeof args.session_id === 'string' && args.session_id.trim()) {
          dto.sessionId = args.session_id.trim()
        }

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
        ctx.onPatientDataMutated?.(userId)
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
        ctx.onPatientDataMutated?.(userId)
        return JSON.stringify({ deleted: true, message: 'Reading deleted successfully.' })
      } catch (err: any) {
        return JSON.stringify({ deleted: false, message: err.message ?? 'Failed to delete.' })
      }
    }

    case 'log_medication_adherence': {
      if (!ctx.adherenceService) {
        return JSON.stringify({
          logged: false,
          message: 'Adherence tool not available — please log via /check-in.',
        })
      }
      const status = typeof args.status === 'string' ? args.status.toLowerCase() : ''
      if (!ADHERENCE_STATUSES.has(status as AdherenceStatus)) {
        return JSON.stringify({
          logged: false,
          message: `Invalid status "${args.status}". Use taken, missed, or scheduled_later.`,
        })
      }
      try {
        const result = await ctx.adherenceService.log(userId, {
          medicationId: typeof args.medication_id === 'string' ? args.medication_id : undefined,
          drugName: typeof args.drug_name === 'string' ? args.drug_name : undefined,
          status: status as AdherenceStatus,
          missedDoses: typeof args.missed_doses === 'number' ? args.missed_doses : undefined,
          reason: typeof args.reason === 'string' ? args.reason : undefined,
        })
        if (result.logged) ctx.onPatientDataMutated?.(userId)
        return JSON.stringify(result)
      } catch (err: any) {
        if (isIntakeIncompleteError(err)) return intakeIncompleteResponse('logged')
        return JSON.stringify({
          logged: false,
          message: err?.message ?? 'Failed to log adherence.',
        })
      }
    }

    case 'log_symptom_quick': {
      if (!ctx.symptomService) {
        return JSON.stringify({
          logged: false,
          message: 'Quick-symptom tool not available — please log via /check-in.',
        })
      }
      const symptom = typeof args.symptom === 'string' ? args.symptom : ''
      if (!STRUCTURED_SYMPTOM_KEYS.has(symptom as StructuredSymptomKey)) {
        return JSON.stringify({
          logged: false,
          message: `Unknown symptom key "${args.symptom}". Use one of: severeHeadache, visualChanges, alteredMentalStatus, chestPainOrDyspnea, focalNeuroDeficit, severeEpigastricPain, newOnsetHeadache, ruqPain, edema, dizziness, syncope, palpitations, legSwelling, fatigue, shortnessOfBreath, dryCough, nsaidUse, faceSwelling, throatTightness.`,
        })
      }
      try {
        const result = await ctx.symptomService.log(userId, {
          symptom: symptom as StructuredSymptomKey,
          notes: typeof args.notes === 'string' && args.notes.trim() ? args.notes.trim() : undefined,
        })
        if (result.logged) ctx.onPatientDataMutated?.(userId)
        return JSON.stringify(result)
      } catch (err: any) {
        if (isIntakeIncompleteError(err)) return intakeIncompleteResponse('logged')
        return JSON.stringify({
          logged: false,
          message: err?.message ?? 'Failed to log symptom.',
        })
      }
    }

    case 'submit_bp_from_photo': {
      if (!ctx.ocrService) {
        return JSON.stringify({
          parsed: false,
          message: 'Photo OCR is not enabled in this build.',
        })
      }
      const b64 = typeof args.image_base64 === 'string' ? args.image_base64 : ''
      const mime = typeof args.mime_type === 'string' ? args.mime_type : ''
      if (!b64 || !mime) {
        return JSON.stringify({
          parsed: false,
          message: 'Missing image_base64 or mime_type.',
        })
      }
      try {
        const buffer = Buffer.from(b64, 'base64')
        const result = await ctx.ocrService.extractBp(userId, buffer, mime)
        // Bug 13 — stamp the OCR moment so submit_checkin can refuse to save
        // until the patient verbally confirms (i.e. there's a user turn
        // between OCR and submit_checkin). The streaming loop in
        // chat.service flips userMessageSince=true on the next user message.
        if (ctx.ocrState) {
          ctx.ocrState.lastAt = Date.now()
          ctx.ocrState.userMessageSince = false
        }
        return JSON.stringify({
          parsed: true,
          sbp: result.sbp,
          dbp: result.dbp,
          pulse: result.pulse,
          confidence: result.confidence,
          message: `Read ${result.sbp} over ${result.dbp}${result.pulse != null ? ', pulse ' + result.pulse : ''} — confirm with the patient before saving.`,
        })
      } catch (err: any) {
        if (err instanceof BpOcrFailure) {
          return JSON.stringify({
            parsed: false,
            code: err.code,
            message: err.message,
          })
        }
        return JSON.stringify({
          parsed: false,
          message: err?.message ?? 'OCR failed.',
        })
      }
    }

    case 'flag_emergency': {
      return JSON.stringify({
        flagged: true,
        emergency_situation: args.emergency_situation ?? 'Emergency detected',
        message: 'Emergency flagged. Continue responding to the patient with 911 guidance.',
      })
    }

    case 'evaluate_reading': {
      if (!ctx.alertEngine) {
        return JSON.stringify({
          evaluated: false,
          message: 'Reading-evaluation tool not available in this build.',
        })
      }
      const sbp = typeof args.systolic_bp === 'number' ? args.systolic_bp : Number(args.systolic_bp)
      const dbp = typeof args.diastolic_bp === 'number' ? args.diastolic_bp : Number(args.diastolic_bp)
      if (!Number.isFinite(sbp) || !Number.isFinite(dbp)) {
        return JSON.stringify({
          evaluated: false,
          message: 'systolic_bp and diastolic_bp must be numbers.',
        })
      }
      const pulseRaw = args.heart_rate
      const pulse = typeof pulseRaw === 'number' && Number.isFinite(pulseRaw)
        ? pulseRaw
        : typeof pulseRaw === 'string' && pulseRaw.trim() && Number.isFinite(Number(pulseRaw))
          ? Number(pulseRaw)
          : null
      const symptoms = mapSymptomsArrayToFlags(args.symptoms)
      try {
        const result = await ctx.alertEngine.evaluateAdHoc({
          userId,
          systolicBP: sbp,
          diastolicBP: dbp,
          pulse,
          symptoms,
        })
        return JSON.stringify(result)
      } catch (err: any) {
        return JSON.stringify({
          evaluated: false,
          message: err?.message ?? 'Reading evaluation failed.',
        })
      }
    }

    case 'finalize_checkin': {
      const entryId = typeof args.entry_id === 'string' ? args.entry_id.trim() : ''
      if (!entryId) {
        return JSON.stringify({
          finalized: false,
          message: 'entry_id is required — pass the id from the previous submit_checkin\'s data.id.',
        })
      }
      try {
        const result = await journalService.finalizeSingleReadingSession(userId, entryId)
        // Single-reading entries that get finalised may now trigger Stage C
        // alerts (BP-high, sbp-low, HR rules) on re-evaluation, which means
        // the patient context's alerts list is about to change. Invalidate
        // the chat-context cache so the NEXT turn shows the fresh alert tier.
        ctx.onPatientDataMutated?.(userId)
        return JSON.stringify({
          finalized: true,
          message: result.message ?? 'Check-in finalised; alerts re-evaluated.',
        })
      } catch (err: any) {
        return JSON.stringify({
          finalized: false,
          message: err?.message ?? 'Failed to finalise check-in.',
        })
      }
    }

    case 'check_intake_status': {
      // Read-only — never throws on backend gate. Just reports completeness so
      // the LLM can decide whether to attempt subsequent BP / log_* tools.
      if (!ctx.intakeStatusService) {
        return JSON.stringify({
          completed: false,
          profile_exists: false,
          intake_url: '/clinical-intake',
          message:
            'Intake-status check is unavailable in this build. Ask the patient if they have completed /clinical-intake before proceeding.',
        })
      }
      const status = await ctx.intakeStatusService.getStatus(userId)
      return JSON.stringify({
        completed: status.completed,
        profile_exists: status.profileExists,
        intake_url: '/clinical-intake',
        message: status.completed
          ? 'Intake is complete — you may proceed with check-ins.'
          : 'Intake is NOT complete. Do not call submit_checkin / log_medication_adherence / log_symptom_quick. Direct the patient to /clinical-intake first.',
      })
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

/**
 * Best-effort map from the loose `symptoms: string[]` the model passes (e.g.
 * `["dizziness", "chest pain"]`) onto the structured-symptom booleans the
 * rule engine consumes. Unknown / freeform strings are dropped — the engine
 * ignores `otherSymptoms` for tier decisions anyway. Case-insensitive; both
 * the structured keys (`chestPainOrDyspnea`) and common natural phrasings
 * (`chest pain`, `shortness of breath`) are recognised.
 */
// Negation prefixes that mean "patient denies this symptom" — must skip the
// mapper, not flip the flag on. Bug 2 fix.
const SYMPTOM_NEGATION_RE = /^(no|not|none|negative for|denies|denying|without|absent|no signs? of)\b/

export function mapSymptomsArrayToFlags(raw: unknown): Partial<SessionSymptoms> | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const flags: Partial<SessionSymptoms> = {}
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const k = item.trim().toLowerCase()
    if (!k) continue
    // Bug 2 fix — naive substring matching would flip
    // `chestPainOrDyspnea = true` on "no chest pain" / "denies chest pain"
    // and fire a Level-2 emergency alert from a denied symptom.
    if (SYMPTOM_NEGATION_RE.test(k)) continue
    // Bug 3 fix — collapse snake_case to the no-underscore form so the
    // schema's `face_swelling` (TIER_1_ANGIOEDEMA airway emergency) matches.
    // Doing this once before the matching block covers every key without
    // per-line edits.
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
