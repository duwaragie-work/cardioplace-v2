import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export async function getProviderStats() {
  const res = await fetchWithAuth(`${API}/api/provider/stats`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getPatients(filters?: {
  riskTier?: string
  hasActiveAlerts?: boolean
  /** PROVIDER privacy scope. Backend force-scopes PROVIDER-only callers
   *  regardless, so passing this from the UI is mainly for clarity. */
  scope?: 'all' | 'assigned'
}) {
  const qs = new URLSearchParams()
  if (filters?.riskTier) qs.append('riskTier', filters.riskTier)
  if (filters?.hasActiveAlerts !== undefined)
    qs.append('hasActiveAlerts', String(filters.hasActiveAlerts))
  if (filters?.scope) qs.append('scope', filters.scope)
  const query = qs.toString()
  const res = await fetchWithAuth(`${API}/api/provider/patients${query ? `?${query}` : ''}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getPatientSummary(userId: string) {
  const res = await fetchWithAuth(`${API}/api/provider/patients/${userId}/summary`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getPatientJournal(userId: string, page?: number, limit?: number) {
  const qs = new URLSearchParams()
  if (page) qs.append('page', String(page))
  if (limit) qs.append('limit', String(limit))
  const query = qs.toString()
  const res = await fetchWithAuth(
    `${API}/api/provider/patients/${userId}/journal${query ? `?${query}` : ''}`,
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

// ─── Patient Detail Readings tab ────────────────────────────────────────────
//
// Typed wrapper around getPatientJournal for the ReadingsTab. Mirrors the
// shape produced by ProviderService.getPatientJournal in the backend (see
// provider.service.ts). Mutations (add/edit/delete below) go through the
// admin readings endpoints (admin-readings.controller.ts) — role-gated to
// SUPER_ADMIN / MEDICAL_DIRECTOR / PROVIDER and audited as ADMIN_READING_*.

export interface PatientJournalEntry {
  id: string
  measuredAt: string
  sessionId: string | null
  systolicBP: number | null
  diastolicBP: number | null
  pulse: number | null
  pulsePressure: number | null
  position: 'SITTING' | 'STANDING' | 'LYING' | null
  weight: number | null
  medicationTaken: boolean | null
  medicationScheduledLater?: boolean
  missedDoses: number | null
  /** Per-medication miss detail snapshot at entry time. */
  missedMedications: Array<{
    medicationId?: string | null
    drugName: string
    drugClass?: string | null
    reason?: string | null
    missedDoses?: number | null
  }> | unknown
  /** Per-med yes/no/not-due-yet snapshot for EVERY answered med — the reading
   *  modal rebuilds each med's exact answer from this on edit/view. */
  medicationStatuses?: Array<{
    medicationId: string
    drugName: string
    drugClass?: string | null
    taken: 'yes' | 'no' | 'scheduledLater'
    reason?: string | null
    missedDoses?: number | null
  }> | unknown
  // Structured Level-2 symptom booleans
  severeHeadache: boolean
  visualChanges: boolean
  alteredMentalStatus: boolean
  chestPainOrDyspnea: boolean
  focalNeuroDeficit: boolean
  severeEpigastricPain: boolean
  newOnsetHeadache: boolean
  ruqPain: boolean
  edema: boolean
  // Cluster 6 — universal symptom signals.
  dizziness?: boolean
  syncope?: boolean
  palpitations?: boolean
  legSwelling?: boolean
  // Cluster 6 Q2 (Manisha 5/9/26) — true when this entry was finalized as
  // a single-reading session by the patient's 5-min timeout. Drives the
  // "Single-reading session" badge on the provider readings view.
  singleReadingFinalized?: boolean
  otherSymptoms: string[]
  measurementConditions: Record<string, unknown> | null
  suboptimalMeasurement: boolean
  // Manisha 5/24 Q1 — narrow pulse pressure (<15) flagged at entry as a
  // possible measurement artifact (physician-only, no patient alert tier).
  narrowPpArtifact?: boolean
  /** Option D (Item B) — retake-to-confirm state. AWAITING = first-of-pair
   *  emergency reading; CONFIRMATORY = the second reading; null = ordinary. */
  emergencyConfirmation?: 'AWAITING' | 'CONFIRMATORY' | 'UNCONFIRMED' | null
  /** On a CONFIRMATORY entry, the id of the AWAITING first-of-pair it confirms. */
  confirmsEntryId?: string | null
  failedConditions: string[]
  notes: string | null
  source: string
  /** Care-team actor on admin-entered readings (source === 'admin'); null on
   *  patient-entered rows. Drives the "entered by [staff]" display. */
  addedByUserId?: string | null
  addedByName?: string | null
  deviations: Array<{
    id: string
    type: string | null
    tier: string | null
    ruleId: string | null
    severity: string | null
    status: string
    escalated: boolean
  }>
  createdAt: string
  updatedAt: string
}

export async function getPatientJournalEntries(
  userId: string,
  opts?: { limit?: number },
): Promise<PatientJournalEntry[]> {
  const data = await getPatientJournal(userId, 1, opts?.limit ?? 200)
  return Array.isArray(data) ? (data as PatientJournalEntry[]) : []
}

// ─── Admin readings CRUD (admin-readings.controller.ts) ─────────────────────

/** Structured symptom booleans the add/edit modal can set — mirrors the
 *  backend CreateJournalEntryDto symptom flags. All optional. */
export interface ReadingSymptoms {
  severeHeadache?: boolean
  visualChanges?: boolean
  alteredMentalStatus?: boolean
  chestPainOrDyspnea?: boolean
  focalNeuroDeficit?: boolean
  severeEpigastricPain?: boolean
  newOnsetHeadache?: boolean
  ruqPain?: boolean
  edema?: boolean
  dizziness?: boolean
  syncope?: boolean
  palpitations?: boolean
  legSwelling?: boolean
  fatigue?: boolean
  shortnessOfBreath?: boolean
  dryCough?: boolean
  nsaidUse?: boolean
  faceSwelling?: boolean
  throatTightness?: boolean
}

export interface AdminReadingInput extends ReadingSymptoms {
  measuredAt: string
  systolicBP: number
  diastolicBP: number
  pulse?: number | null
  position?: 'SITTING' | 'STANDING' | 'LYING' | null
  /** Kilograms — callers convert lbs before sending (×0.45359237), mirroring
   *  the patient check-in. Backend stores Decimal kg. */
  weight?: number | null
  /** Freeform symptoms not covered by the structured booleans —
   *  JournalEntry.otherSymptoms. */
  otherSymptoms?: string[]
  notes?: string | null
  // Medication adherence rollup + per-med detail — same derivation as the
  // patient check-in (CheckIn.tsx handleSubmit): medicationTaken only when
  // every med answered AND at least one explicit yes/no; scheduledLater =
  // any "not due yet"; missedMedications only for missed meds WITH a reason;
  // medicationStatuses for every answered med.
  medicationTaken?: boolean | null
  medicationScheduledLater?: boolean
  missedMedications?: Array<{
    medicationId: string
    drugName: string
    drugClass: string
    reason: string
    missedDoses: number
  }>
  medicationStatuses?: Array<{
    medicationId: string
    drugName: string
    drugClass: string
    taken: 'yes' | 'no' | 'scheduledLater'
    reason?: string
    missedDoses?: number
  }>
  /** Joins an existing multi-reading session. The backend 400s "Session
   *  expired or invalid" when the 5-min window has elapsed; absent, the
   *  backend assigns a fresh sessionId (returned on the created entry). */
  sessionId?: string | null
}

async function mutateReading<T>(
  url: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const res = await fetchWithAuth(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Backend error bodies carry message OR { message, reason } (e.g. the
    // implausible-reading 422) — prefer the human-readable reason.
    throw new Error(json.reason || json.message || `Request failed: ${res.status}`)
  }
  return (json.data ?? json) as T
}

export async function addReading(
  userId: string,
  input: AdminReadingInput,
): Promise<PatientJournalEntry> {
  return mutateReading<PatientJournalEntry>(
    `${API}/api/admin/patients/${userId}/readings`,
    'POST',
    input,
  )
}

export async function editReading(
  userId: string,
  entryId: string,
  input: Partial<AdminReadingInput>,
): Promise<PatientJournalEntry> {
  return mutateReading<PatientJournalEntry>(
    `${API}/api/admin/patients/${userId}/readings/${entryId}`,
    'PUT',
    input,
  )
}

export async function deleteReading(userId: string, entryId: string): Promise<void> {
  await mutateReading<unknown>(
    `${API}/api/admin/patients/${userId}/readings/${entryId}`,
    'DELETE',
  )
}

// Manisha 5/24 Q1 — readings rejected at entry (DBP ≥ SBP). Never persisted as
// journal rows; surfaced on the Readings tab as an informational QA note.
export interface RejectedReading {
  id: string
  systolicBP: number | null
  diastolicBP: number | null
  pulse: number | null
  reason: string
  createdAt: string
}

export async function getPatientRejectedReadings(
  userId: string,
  opts?: { limit?: number },
): Promise<RejectedReading[]> {
  const qs = new URLSearchParams()
  if (opts?.limit) qs.append('limit', String(opts.limit))
  const query = qs.toString()
  const res = await fetchWithAuth(
    `${API}/api/provider/patients/${userId}/rejected-readings${query ? `?${query}` : ''}`,
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  const data = json.data ?? json
  return Array.isArray(data) ? (data as RejectedReading[]) : []
}

export async function getPatientBpTrend(userId: string, startDate: string, endDate: string) {
  const qs = new URLSearchParams({ startDate, endDate })
  const res = await fetchWithAuth(`${API}/api/provider/patients/${userId}/bp-trend?${qs}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getProviderAlerts(filters?: {
  severity?: string
  escalated?: boolean
  /** PROVIDER privacy scope — see getPatients. */
  scope?: 'all' | 'assigned'
}) {
  const qs = new URLSearchParams()
  if (filters?.severity) qs.append('severity', filters.severity)
  if (filters?.escalated !== undefined) qs.append('escalated', String(filters.escalated))
  if (filters?.scope) qs.append('scope', filters.scope)
  const query = qs.toString()
  const res = await fetchWithAuth(`${API}/api/provider/alerts${query ? `?${query}` : ''}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getAlertDetail(alertId: string) {
  const res = await fetchWithAuth(`${API}/api/provider/alerts/${alertId}/detail`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function acknowledgeProviderAlert(alertId: string) {
  const res = await fetchWithAuth(`${API}/api/provider/alerts/${alertId}/acknowledge`, {
    method: 'PATCH',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 alert resolution — Flow F / Flow G
// ─────────────────────────────────────────────────────────────────────────────

export type AlertTier =
  | 'TIER_1_CONTRAINDICATION'
  | 'TIER_2_DISCREPANCY'
  | 'TIER_3_INFO'
  | 'BP_LEVEL_1_HIGH'
  | 'BP_LEVEL_1_LOW'
  | 'BP_LEVEL_2'
  | 'BP_LEVEL_2_SYMPTOM_OVERRIDE'

export type ResolutionAction =
  // Tier 1 — contraindication / safety-critical
  | 'TIER1_DISCONTINUED'
  | 'TIER1_CHANGE_ORDERED'
  | 'TIER1_FALSE_POSITIVE'
  | 'TIER1_ACKNOWLEDGED'
  | 'TIER1_DEFERRED'
  // Tier 2 — discrepancy / non-adherence
  | 'TIER2_REVIEWED_NO_ACTION'
  | 'TIER2_WILL_CONTACT'
  | 'TIER2_CHANGE_ORDERED'
  | 'TIER2_PHARMACY_RECONCILE'
  | 'TIER2_DEFERRED'
  // BP Level 2 — emergency
  | 'BP_L2_CONTACTED_MED_ADJUSTED'
  | 'BP_L2_CONTACTED_ADVISED_ED'
  | 'BP_L2_CONTACTED_RECHECK'
  | 'BP_L2_SEEN_IN_OFFICE'
  | 'BP_L2_REVIEWED_TRENDING_DOWN'
  | 'BP_L2_UNABLE_TO_REACH_RETRY'
  // Tier 1 angioedema (Manisha 5/24 Q4) — bespoke 6-option set
  | 'ANGIO_ADVISED_ED'
  | 'ANGIO_CONFIRMED_ED'
  | 'ANGIO_ACE_DISCONTINUED'
  | 'ANGIO_SEEN_IN_OFFICE'
  | 'ANGIO_FALSE_ALARM'
  | 'ANGIO_UNABLE_TO_REACH'

export type ResolutionTier = 'TIER_1' | 'TIER_2' | 'BP_LEVEL_2' | 'TIER_1_ANGIOEDEMA'

/** Conditional sub-field rendered under an angioedema resolution action and
 *  posted into resolutionDetails. Mirrors backend ResolutionSubField. */
export interface ResolutionSubField {
  key: string
  label: string
  kind: 'yesno' | 'text'
  required: boolean
}

export interface ResolutionActionDef {
  tier: ResolutionTier
  label: string
  /** Patient-facing description of what this action means clinically. */
  description?: string
  requiresRationale: boolean
  triggersBpL2Retry?: boolean
  /** Conditional sub-fields (angioedema actions). */
  subFields?: ResolutionSubField[]
  /** UI hint — this action carries a destructive/clinical side-effect
   *  (auto-discontinue ACE/ARB + permanent contraindication flag). */
  warnSideEffect?: string
}

/**
 * Mirrors backend RESOLUTION_CATALOG (resolution-actions.ts). Kept in sync
 * by hand for now — small, stable enum. If actions ever expand, swap to a
 * GET /admin/resolution-actions endpoint.
 */
export const RESOLUTION_CATALOG: Record<ResolutionAction, ResolutionActionDef> = {
  TIER1_DISCONTINUED: {
    tier: 'TIER_1',
    label: 'Confirmed — medication discontinued',
    description: 'Patient confirmed off the medication; will contact patient if needed.',
    requiresRationale: true,
  },
  TIER1_CHANGE_ORDERED: {
    tier: 'TIER_1',
    label: 'Confirmed — medication change ordered',
    description: 'New prescription / change-of-therapy issued.',
    requiresRationale: true,
  },
  TIER1_FALSE_POSITIVE: {
    tier: 'TIER_1',
    label: 'False positive — patient is not [condition] / medication incorrect',
    description: 'Patient self-report appears wrong; explain in rationale.',
    requiresRationale: true,
  },
  TIER1_ACKNOWLEDGED: {
    tier: 'TIER_1',
    label: 'Acknowledged — provider aware, clinical rationale documented',
    description: 'Provider intentionally maintaining the combo; document why.',
    requiresRationale: true,
  },
  TIER1_DEFERRED: {
    tier: 'TIER_1',
    label: 'Deferred to in-person visit',
    description: 'Will address at upcoming visit (24h / 48h / 1 week).',
    requiresRationale: true,
  },

  TIER2_REVIEWED_NO_ACTION: {
    tier: 'TIER_2',
    label: 'Reviewed — no action needed',
    description: 'Reviewed but no follow-up required (rationale required).',
    requiresRationale: true,
  },
  TIER2_WILL_CONTACT: {
    tier: 'TIER_2',
    label: 'Will contact patient to discuss',
    requiresRationale: false,
  },
  TIER2_CHANGE_ORDERED: {
    tier: 'TIER_2',
    label: 'Medication change ordered',
    requiresRationale: false,
  },
  TIER2_PHARMACY_RECONCILE: {
    tier: 'TIER_2',
    label: 'Referred to pharmacy for reconciliation',
    requiresRationale: false,
  },
  TIER2_DEFERRED: {
    tier: 'TIER_2',
    label: 'Deferred to next scheduled visit',
    requiresRationale: false,
  },

  BP_L2_CONTACTED_MED_ADJUSTED: {
    tier: 'BP_LEVEL_2',
    label: 'Patient contacted — medication adjusted',
    requiresRationale: true,
  },
  BP_L2_CONTACTED_ADVISED_ED: {
    tier: 'BP_LEVEL_2',
    label: 'Patient contacted — advised to go to ED',
    requiresRationale: true,
  },
  BP_L2_CONTACTED_RECHECK: {
    tier: 'BP_LEVEL_2',
    label: 'Patient contacted — BP re-check requested',
    requiresRationale: true,
  },
  BP_L2_SEEN_IN_OFFICE: {
    tier: 'BP_LEVEL_2',
    label: 'Patient seen in office — management updated',
    requiresRationale: true,
  },
  BP_L2_REVIEWED_TRENDING_DOWN: {
    tier: 'BP_LEVEL_2',
    label: 'Reviewed — BP trending down, no immediate action',
    description: 'Document trend evidence in rationale.',
    requiresRationale: true,
  },
  BP_L2_UNABLE_TO_REACH_RETRY: {
    tier: 'BP_LEVEL_2',
    label: 'Unable to reach patient — will retry',
    description: 'Schedules a fresh T+4h escalation with primary + backup.',
    requiresRationale: true,
    triggersBpL2Retry: true,
  },

  // ── Tier 1 Angioedema (Manisha 5/24 Q4) ─────────────────────────────────
  ANGIO_ADVISED_ED: {
    tier: 'TIER_1_ANGIOEDEMA',
    label: 'Advised patient to call 911 / go to the ED',
    description: 'If the patient declines, an immediate Medical Director escalation fires and the alert stays open.',
    requiresRationale: true,
    subFields: [
      { key: 'willGo', label: 'Patient agreed to go to the ED', kind: 'yesno', required: true },
    ],
  },
  ANGIO_CONFIRMED_ED: {
    tier: 'TIER_1_ANGIOEDEMA',
    label: 'Confirmed patient is being evaluated in the ED',
    requiresRationale: true,
    subFields: [
      { key: 'facility', label: 'Facility / ED name', kind: 'text', required: true },
    ],
  },
  ANGIO_ACE_DISCONTINUED: {
    tier: 'TIER_1_ANGIOEDEMA',
    label: 'ACE inhibitor / ARB discontinued',
    requiresRationale: true,
    warnSideEffect:
      'This discontinues the patient’s ACE/ARB medications and sets a permanent ACE-inhibitor contraindication on their profile.',
    subFields: [
      { key: 'replacementOrdered', label: 'Replacement therapy ordered', kind: 'yesno', required: true },
      { key: 'replacementMed', label: 'Replacement medication (if ordered)', kind: 'text', required: false },
    ],
  },
  ANGIO_SEEN_IN_OFFICE: {
    tier: 'TIER_1_ANGIOEDEMA',
    label: 'Patient seen in office',
    requiresRationale: true,
    subFields: [
      { key: 'outcome', label: 'Office visit outcome', kind: 'text', required: true },
    ],
  },
  ANGIO_FALSE_ALARM: {
    tier: 'TIER_1_ANGIOEDEMA',
    label: 'False alarm — not angioedema',
    description: 'No contraindication flag is set.',
    requiresRationale: true,
    subFields: [
      { key: 'actualCause', label: 'Actual cause of symptoms', kind: 'text', required: true },
    ],
  },
  ANGIO_UNABLE_TO_REACH: {
    tier: 'TIER_1_ANGIOEDEMA',
    label: 'Unable to reach patient — continue escalation',
    description: 'Alert stays open; the compressed angioedema ladder keeps escalating.',
    requiresRationale: true,
  },
}

/** AlertTier (DB enum) → ResolutionTier (catalog grouping). */
export function resolutionTierFor(tier: AlertTier | string | null): ResolutionTier | null {
  switch (tier) {
    case 'TIER_1_CONTRAINDICATION':
      return 'TIER_1'
    // Manisha 5/24 Q4 — angioedema now has its own bespoke 6-option catalog
    // (auto-discontinue ACE/ARB, permanent contraindication flag, targeted MD
    // escalation, compressed re-escalation), split out of the generic Tier 1.
    case 'TIER_1_ANGIOEDEMA':
      return 'TIER_1_ANGIOEDEMA'
    case 'TIER_2_DISCREPANCY':
      return 'TIER_2'
    case 'BP_LEVEL_2':
    case 'BP_LEVEL_2_SYMPTOM_OVERRIDE':
      return 'BP_LEVEL_2'
    default:
      return null
  }
}

export function actionsForTier(tier: AlertTier | string | null): ResolutionAction[] {
  const group = resolutionTierFor(tier)
  if (!group) return []
  return (Object.entries(RESOLUTION_CATALOG) as [ResolutionAction, ResolutionActionDef][])
    .filter(([, def]) => def.tier === group)
    .map(([k]) => k)
}

// ─── Notifications ──────────────────────────────────────────────────────────
//
// Bell + /admin/notifications page both pull from this. The endpoint is
// scoped to the authenticated user (admin sees their own dispatched
// notifications — escalation pings, dashboard pushes, etc.). Filters
// EMAIL-channel rows by default since those are tracking-only and don't
// represent in-app state the admin can act on.
//
// Multi-channel dedupe: each escalation step writes one Notification row
// per channel (e.g. Tier 1 T+0 fans out PUSH + EMAIL + DASHBOARD), so the
// raw API returns multiple rows for the same logical event. We collapse
// rows that share an `escalationEventId` into a single canonical entry
// (preferring PUSH > DASHBOARD > PHONE for display) and stash every
// underlying row id on `siblingIds` so mark-read can flip all of them in
// one bulk PATCH. Rows without an escalation event id (alert-engine
// dashboard pushes, resolution pings) stand alone.

export interface AdminNotificationDto {
  id: string
  alertId: string | null
  /** Patient who triggered the linked alert (NULL when alertId is null).
   *  Needed for the bell / notifications row to deep-link to
   *  /patients/{patientUserId}?alert={alertId} — `id` is the recipient's
   *  user id, not the patient. */
  patientUserId: string | null
  /** Set when the row originated from the escalation ladder. Used for
   *  multi-channel dedupe so the same step doesn't appear twice in the
   *  inbox. */
  escalationEventId: string | null
  channel: 'PUSH' | 'EMAIL' | 'PHONE' | 'DASHBOARD'
  title: string
  body: string
  tips?: string[]
  sentAt: string
  readAt: string | null
  watched: boolean
  /** Every Notification row id that merged into this canonical entry
   *  (always at least `[id]`). Mark-read flows pass this to the bulk
   *  endpoint so all channel siblings flip together. */
  siblingIds: string[]
}

const CHANNEL_RANK: Record<string, number> = {
  PUSH: 0,
  DASHBOARD: 1,
  PHONE: 2,
  EMAIL: 3,
}

export async function getAdminNotifications(opts?: {
  status?: 'all' | 'unread' | 'read'
  /** Soft cap on returned rows (the bell needs ~10, the page wants more).
   *  Applied AFTER dedupe so the cap counts logical entries, not raw rows. */
  limit?: number
}): Promise<AdminNotificationDto[]> {
  const status = opts?.status ?? 'all'
  const res = await fetchWithAuth(`${API}/api/daily-journal/notifications?status=${status}`)
  if (!res.ok) return []
  const json = await res.json()
  type RawRow = Omit<AdminNotificationDto, 'siblingIds'>
  const data: RawRow[] = Array.isArray(json?.data) ? json.data : []
  // EMAIL rows are SMTP receipts, not in-app surface — drop before grouping
  // so they can't end up as the canonical row of a group.
  const filtered = data.filter((n) => n.channel !== 'EMAIL')
  // Group by escalation event when present; standalone rows keep their own
  // group so unrelated notifications never collapse into each other.
  const groups = new Map<string, RawRow[]>()
  for (const n of filtered) {
    const key = n.escalationEventId ? `evt:${n.escalationEventId}` : `solo:${n.id}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(n)
    else groups.set(key, [n])
  }
  const merged: AdminNotificationDto[] = []
  for (const siblings of groups.values()) {
    const sorted = [...siblings].sort(
      (a, b) => (CHANNEL_RANK[a.channel] ?? 99) - (CHANNEL_RANK[b.channel] ?? 99),
    )
    const rep = sorted[0]
    // The merged row is unread iff ANY sibling row is unread — closes the
    // gap where the user marks the PUSH row read but DASHBOARD stays unread
    // and re-shows the entry on next fetch.
    const watched = siblings.every((s) => s.watched)
    merged.push({
      ...rep,
      watched,
      siblingIds: siblings.map((s) => s.id),
    })
  }
  // Server already orders by sentAt desc, but dedupe scrambles iteration
  // order — re-sort so the inbox stays chronological.
  merged.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
  return opts?.limit ? merged.slice(0, opts.limit) : merged
}

export async function markAdminNotificationRead(id: string): Promise<void> {
  await fetchWithAuth(`${API}/api/daily-journal/notifications/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ watched: true }),
  })
}

export async function markAdminNotificationsReadBulk(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await fetchWithAuth(`${API}/api/daily-journal/notifications/bulk-status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, watched: true }),
  })
}

/**
 * Resolve an alert via the admin endpoint. The endpoint validates that
 * `action` matches the alert's tier and that `rationale` is provided when
 * the chosen action requires it. Throws on 4xx / 5xx with the server's
 * error message.
 */
export async function resolveAlert(
  alertId: string,
  action: ResolutionAction,
  rationale?: string,
  resolutionDetails?: Record<string, unknown>,
): Promise<{ status: 'RESOLVED' | 'OPEN'; resolvedAt: string | null; retryScheduledFor?: string }> {
  const res = await fetchWithAuth(`${API}/api/admin/alerts/${alertId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resolutionAction: action,
      resolutionRationale: rationale,
      ...(resolutionDetails ? { resolutionDetails } : {}),
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return (json.data ?? json) as {
    status: 'RESOLVED' | 'OPEN'
    resolvedAt: string | null
    retryScheduledFor?: string
  }
}
