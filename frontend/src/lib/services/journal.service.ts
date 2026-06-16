// Patient daily-journal API client. Fields mirror the backend
// CreateJournalEntryDto: `measuredAt` (single UTC timestamp) replaced the v1
// `entryDate` + `measurementTime` pair in phase/2; structured Level-2 symptom
// booleans were added in phase/15 alongside Flow B.

import { fetchWithAuth } from './token'
import type { DelayBand } from '../delayBand'

const API = process.env.NEXT_PUBLIC_API_URL

export type MissedMedicationReason =
  | 'FORGOT'
  | 'SIDE_EFFECTS'
  | 'RAN_OUT'
  | 'COST'
  | 'INTENTIONAL'
  | 'OTHER'

export interface MissedMedicationPayload {
  medicationId: string
  drugName: string
  drugClass: string
  reason: MissedMedicationReason
  missedDoses: number
}

/** Per-medication status snapshot for every answered med (taken / missed /
 * not-due-yet). Lets the readings edit modal + detail view reconstruct each
 * med's exact answer on reopen — the aggregate medicationTaken +
 * medicationScheduledLater flags can't tell "med A taken" from "med B not due
 * yet". UI-reconstruction only; the rule engine ignores it. */
export interface MedicationStatusPayload {
  medicationId?: string
  drugName: string
  drugClass?: string
  taken: 'yes' | 'no' | 'scheduledLater'
  reason?: MissedMedicationReason
  missedDoses?: number
}

export interface JournalEntryPayload {
  /** ISO 8601 UTC timestamp. Required by the backend. */
  measuredAt: string
  systolicBP?: number
  diastolicBP?: number
  pulse?: number
  weight?: number
  position?: 'SITTING' | 'STANDING' | 'LYING'
  /** UUID grouping multiple readings taken within ~30 min (rule engine averages them). */
  sessionId?: string
  /** Pre-measurement 8-item checklist captured as a JSON object. */
  measurementConditions?: Record<string, unknown>
  medicationTaken?: boolean | null
  /** Phase/26 — patient explicitly flagged ANY medication as not-due-yet on
   * this entry. Distinct from `medicationTaken` so the rule engine knows
   * the gap is intentional, not a missed dose. */
  medicationScheduledLater?: boolean
  missedDoses?: number
  /** Per-medication miss detail. Submitted when the patient taps "Missed"
   * and checks off specific drugs in CheckIn.tsx. */
  missedMedications?: MissedMedicationPayload[]
  /** Per-medication status snapshot for every answered med (UI reconstruction). */
  medicationStatuses?: MedicationStatusPayload[]
  // Structured V2 Level-2 symptom triggers
  severeHeadache?: boolean
  visualChanges?: boolean
  alteredMentalStatus?: boolean
  chestPainOrDyspnea?: boolean
  focalNeuroDeficit?: boolean
  severeEpigastricPain?: boolean
  // Pregnancy-specific (only if PatientProfile.isPregnant)
  newOnsetHeadache?: boolean
  ruqPain?: boolean
  edema?: boolean
  // Cluster 6 (Manisha 5/10/26) — universal symptom signals.
  dizziness?: boolean
  syncope?: boolean
  palpitations?: boolean
  legSwelling?: boolean
  // Cluster 7 (Manisha 5/11/26) — Appendix A side-effect inputs.
  fatigue?: boolean
  shortnessOfBreath?: boolean
  dryCough?: boolean
  // Cluster 8 (Manisha 5/18/26, P0) — ACE-angioedema airway emergency.
  faceSwelling?: boolean
  throatTightness?: boolean
  /** Patient's "anything else" freeform notes — stored as String[]. */
  otherSymptoms?: string[]
  notes?: string
  source?: 'manual' | 'healthkit'
  // ── Option D — retake-to-confirm (Manisha 2026-06-12 Q2) ──────────────────
  /** First-of-pair: persist this emergency reading as held (AWAITING) and
   *  prompt for a confirmatory second reading. The 202 response carries
   *  `pendingEmergencyConfirmation: true` + the entry id (data.id). */
  beginEmergencyConfirmation?: boolean
  /** Second-of-pair: the AWAITING first-of-pair id this reading confirms/clears. */
  confirmsEntryId?: string
  /** Bug 19 — the patient explicitly closed this session ("I'm good" buffer
   *  commit / Option D confirmatory). The backend stamps `sessionClosedAt` on the
   *  whole session so the active-session prompt won't re-offer it. */
  closeSession?: boolean
}

export interface JournalEntryDto extends JournalEntryPayload {
  id: string
  userId: string
  createdAt: string
  updatedAt: string
  /** Chunk A backend (serializeEntry) surfaces the measurement-lag band on the
   *  journal-entry POST response; Chunk C reads it to render the
   *  HISTORICAL_ENTRY informational note. Defaults to 'REAL_TIME' server-side. */
  delayBand?: DelayBand
  /** Chunk B fix-up (Manisha Backdated Readings sign-off 2026-06-06) — why
   *  real-time alerts were suppressed for this entry, if at all. 'GATE_A'
   *  (a later-measured reading already exists) is POST-response-only;
   *  'HISTORICAL_ENTRY' also appears on GETs (derived from delayBand). Both
   *  render the same "recorded but won't trigger real-time alerts" banner. */
  alertsSuppressedReason?: 'GATE_A' | 'HISTORICAL_ENTRY' | null
  /** Option D + edit window (Manisha 2026-06-12) — ISO deadline before the
   *  engine commits; while now < this, the readings page shows the "editable /
   *  not yet sent" affordance. Null for admin / Option D AWAITING readings. */
  engineEvaluationDeferredUntil?: string | null
  /** Option D retake-confirm state: 'AWAITING' | 'CONFIRMATORY' | 'UNCONFIRMED'
   *  or null for ordinary readings. */
  emergencyConfirmation?: 'AWAITING' | 'CONFIRMATORY' | 'UNCONFIRMED' | null
}

/**
 * Thrown when POST /daily-journal returns 403 `clinical-intake-required` —
 * Layer A journaling gate. Callers should route the patient to
 * `/clinical-intake` rather than surfacing the raw error. See
 * docs/TESTING_FLOW_GUIDE.md §6.1.
 */
export class ClinicalIntakeRequiredError extends Error {
  readonly code = 'clinical-intake-required' as const
  constructor(reason?: string) {
    super(reason || 'Complete your clinical intake before logging readings.')
    this.name = 'ClinicalIntakeRequiredError'
  }
}

/**
 * Thrown when POST /daily-journal returns 422 `implausible-reading` — a
 * physiologically-impossible reading (diastolic ≥ systolic, Manisha 5/24 Q1).
 * The reading is NOT saved; callers prompt the patient to re-take it.
 */
export class ImplausibleReadingError extends Error {
  readonly code = 'implausible-reading' as const
  constructor(reason?: string) {
    super(reason || "That reading doesn't look right — please check your cuff and try again.")
    this.name = 'ImplausibleReadingError'
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    if (res.status === 403 && err?.message === 'clinical-intake-required') {
      throw new ClinicalIntakeRequiredError(err.reason)
    }
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return (json.data ?? json) as T
}

/**
 * Cluster 6 Q2 (Manisha 5/9/26) — backend hint to render the "Take a second
 * reading in about 1 minute" prompt + 5-min timeout. True when the just-
 * created entry is the only one in its session AND the patient isn't AFib
 * AND isn't Pre-Day-3.
 */
export interface JournalEntryCreated {
  entry: JournalEntryDto
  pendingSecondReading: boolean
  /** Option D (Manisha 2026-06-12 Q2) — true when this was a BP-only emergency
   *  submitted with `beginEmergencyConfirmation`: the reading is held and the
   *  app should show the confirmatory second-reading screen (Screen B). */
  pendingEmergencyConfirmation: boolean
}

export async function createJournalEntry(
  data: JournalEntryPayload,
): Promise<JournalEntryCreated> {
  const res = await fetchWithAuth(`${API}/api/daily-journal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    if (res.status === 403 && err?.message === 'clinical-intake-required') {
      throw new ClinicalIntakeRequiredError(err.reason)
    }
    if (res.status === 422 && err?.message === 'implausible-reading') {
      throw new ImplausibleReadingError(err.reason)
    }
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return {
    entry: (json.data ?? json) as JournalEntryDto,
    pendingSecondReading: Boolean(json.pendingSecondReading),
    pendingEmergencyConfirmation: Boolean(json.pendingEmergencyConfirmation),
  }
}

/**
 * GET /daily-journal/active-session — the patient's currently OPEN reading
 * session, or null when none/expired. Drives the check-in "add to this
 * session or start a new one?" prompt. `sessionId` is null for a time-window
 * (un-tagged) session — join it by sending no sessionId.
 */
export interface ActiveSessionDto {
  sessionId: string | null
  openedAt: string // ISO — first reading in the session
  lastReadingAt: string // ISO — most recent reading
  readingCount: number
  expiresAt: string // ISO — lastReadingAt + SESSION_WINDOW_MS (server-authoritative)
  requiresMoreReadings: boolean // e.g. AFib && readingCount < 3
}

export async function getActiveSession(): Promise<ActiveSessionDto | null> {
  const res = await fetchWithAuth(`${API}/api/daily-journal/active-session`)
  if (res.status === 204) return null
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json().catch(() => null)
  const data = (json?.data ?? json) as ActiveSessionDto | null
  return data ?? null
}

/**
 * GET /daily-journal/awaiting-emergency — the patient's most recent held
 * emergency reading (Option D, Manisha 2026-06-12 Q2) awaiting its confirmatory
 * second reading, or null when none. Drives the /check-in Screen A auto-resume
 * and the /readings "Continue confirmation" CTA.
 */
export interface AwaitingEmergencyDto {
  id: string
  sessionId: string | null // the held first-of-pair's session (resume reuses it)
  systolicBP: number | null
  diastolicBP: number | null
  measuredAt: string // ISO — when the held first-of-pair was taken
}

export async function getAwaitingEmergency(): Promise<AwaitingEmergencyDto | null> {
  const res = await fetchWithAuth(`${API}/api/daily-journal/awaiting-emergency`)
  if (res.status === 204) return null
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json().catch(() => null)
  const data = (json?.data ?? json) as AwaitingEmergencyDto | null
  return data ?? null
}

/**
 * Cluster 6 Q2 — fires after the patient's 5-min "take a second reading"
 * window times out without a second reading. Flips
 * JournalEntry.singleReadingFinalized = true server-side; engine then fires
 * the alert with a "confirm with next reading" annotation. Idempotent.
 */
export async function finalizeSingleReadingSession(entryId: string): Promise<void> {
  const res = await fetchWithAuth(
    `${API}/api/daily-journal/${entryId}/finalize-single-reading`,
    { method: 'POST' },
  )
  if (!res.ok && res.status !== 200 && res.status !== 202) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Finalize failed: ${res.status}`)
  }
}

/**
 * Option D (Manisha 2026-06-12 Q2) — patient declined / closed the
 * confirmatory retake (Screen C) or the 5-min window elapsed client-side.
 * Resolves the held AWAITING first-of-pair as UNCONFIRMED (fires
 * RULE_UNCONFIRMED_EMERGENCY, Tier 1 provider-only). Idempotent; the cron is
 * the app-closed safety net. Best-effort — a failure is non-fatal (the cron
 * still finalizes), so callers swallow errors.
 */
export async function declineEmergencyConfirmation(entryId: string): Promise<void> {
  const res = await fetchWithAuth(
    `${API}/api/daily-journal/${entryId}/decline-confirmation`,
    { method: 'POST' },
  )
  if (!res.ok && res.status !== 200 && res.status !== 202) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Decline failed: ${res.status}`)
  }
}

export async function updateJournalEntry(
  id: string,
  data: Partial<JournalEntryPayload>,
): Promise<JournalEntryDto> {
  const res = await fetchWithAuth(`${API}/api/daily-journal/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return unwrap<JournalEntryDto>(res)
}

export async function deleteJournalEntry(id: string) {
  const res = await fetchWithAuth(`${API}/api/daily-journal/${id}`, {
    method: 'DELETE',
  })
  return unwrap<unknown>(res)
}

export async function getJournalEntries(params?: {
  startDate?: string
  endDate?: string
  limit?: number
}): Promise<JournalEntryDto[]> {
  const qs = new URLSearchParams()
  if (params?.startDate) qs.append('startDate', params.startDate)
  if (params?.endDate) qs.append('endDate', params.endDate)
  if (params?.limit) qs.append('limit', String(params.limit))
  const query = qs.toString()
  const res = await fetchWithAuth(`${API}/api/daily-journal${query ? `?${query}` : ''}`)
  return unwrap<JournalEntryDto[]>(res)
}

export async function getJournalHistory(page?: number, limit?: number) {
  const qs = new URLSearchParams()
  if (page) qs.append('page', String(page))
  if (limit) qs.append('limit', String(limit))
  const query = qs.toString()
  const res = await fetchWithAuth(`${API}/api/daily-journal/history${query ? `?${query}` : ''}`)
  return unwrap<unknown>(res)
}

export async function getJournalEntry(id: string): Promise<JournalEntryDto> {
  const res = await fetchWithAuth(`${API}/api/daily-journal/${id}`)
  return unwrap<JournalEntryDto>(res)
}

export async function getLatestBaseline() {
  const res = await fetchWithAuth(`${API}/api/daily-journal/baseline/latest`)
  return unwrap<unknown>(res)
}

// V2 alert tier — mirrors AlertTier enum on the backend.
export type AlertTier =
  | 'TIER_1_CONTRAINDICATION'
  | 'TIER_2_DISCREPANCY'
  | 'TIER_3_INFO'
  | 'BP_LEVEL_1_HIGH'
  | 'BP_LEVEL_1_LOW'
  | 'BP_LEVEL_2'
  | 'BP_LEVEL_2_SYMPTOM_OVERRIDE'
  // Cluster 8 — ACE-angioedema airway emergency (non-dismissable Tier 1).
  | 'TIER_1_ANGIOEDEMA'

export interface DeviationAlertDto {
  id: string
  userId: string
  journalEntryId: string
  // V1 legacy
  type?: string | null
  severity?: string | null
  magnitude?: number | null
  baselineValue?: number | null
  actualValue?: number | null
  // V2
  tier?: AlertTier | null
  ruleId?: string | null
  mode?: 'STANDARD' | 'PERSONALIZED' | null
  pulsePressure?: number | null
  suboptimalMeasurement?: boolean
  patientMessage?: string | null
  caregiverMessage?: string | null
  physicianMessage?: string | null
  dismissible?: boolean
  resolutionAction?: string | null
  resolutionRationale?: string | null
  resolvedBy?: string | null
  escalated?: boolean
  status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
  createdAt: string
  acknowledgedAt?: string | null
  // Joined journalEntry snapshot
  journalEntry?: {
    id: string
    measuredAt: string
    systolicBP?: number | null
    diastolicBP?: number | null
    pulse?: number | null
    weight?: number | null
  } | null
}

export async function getAlerts(): Promise<DeviationAlertDto[]> {
  const res = await fetchWithAuth(`${API}/api/daily-journal/alerts`)
  const all = await unwrap<DeviationAlertDto[]>(res)
  // Bug 12 (live-test 2026-06-15) — defense-in-depth. The backend now filters
  // EVERY provider-only alert (empty patientMessage, any tier) out of the
  // patient surface; this mirrors that universally so a backend regression
  // can't leak a tier-generic "Important medication alert" card (e.g. the
  // Tier-1 RULE_UNCONFIRMED_EMERGENCY) onto the patient. Only alerts with a
  // real patient message render.
  return all.filter(
    (a) => typeof a.patientMessage === 'string' && a.patientMessage.trim().length > 0,
  )
}

export async function acknowledgeAlert(alertId: string) {
  const res = await fetchWithAuth(`${API}/api/daily-journal/alerts/${alertId}/acknowledge`, {
    method: 'PATCH',
  })
  return unwrap<unknown>(res)
}

export async function getJournalStats() {
  const res = await fetchWithAuth(`${API}/api/daily-journal/stats`)
  return unwrap<{ totalEntries?: number; currentStreak?: number } | null>(res)
}

export async function getEscalations() {
  const res = await fetchWithAuth(`${API}/api/daily-journal/escalations`)
  return unwrap<unknown>(res)
}

export async function getNotifications(status?: 'all' | 'read' | 'unread') {
  const qs = status ? `?status=${status}` : ''
  const res = await fetchWithAuth(`${API}/api/daily-journal/notifications${qs}`)
  return unwrap<unknown>(res)
}

export async function markNotificationRead(id: string, watched: boolean) {
  const res = await fetchWithAuth(`${API}/api/daily-journal/notifications/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ watched }),
  })
  return unwrap<unknown>(res)
}
