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
// provider.service.ts). Read-only — the admin doesn't edit patient
// readings here; that's a patient-side action only.

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
  missedDoses: number | null
  /** Per-medication miss detail snapshot at entry time. */
  missedMedications: Array<{
    medicationId?: string | null
    drugName: string
    drugClass?: string | null
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
  failedConditions: string[]
  notes: string | null
  source: string
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

export async function scheduleCall(body: {
  patientUserId: string
  alertId?: string
  callDate: string
  callTime: string
  callType: string
  notes?: string
}) {
  const res = await fetchWithAuth(`${API}/api/provider/schedule-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json
}

export async function getScheduledCalls(filters?: { status?: string }) {
  const qs = new URLSearchParams()
  if (filters?.status) qs.append('status', filters.status)
  const query = qs.toString()
  const res = await fetchWithAuth(`${API}/api/provider/scheduled-calls${query ? `?${query}` : ''}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function updateCallStatus(callId: string, status: string) {
  const res = await fetchWithAuth(`${API}/api/provider/scheduled-calls/${callId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function deleteScheduledCall(callId: string) {
  const res = await fetchWithAuth(`${API}/api/provider/scheduled-calls/${callId}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json
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

export type ResolutionTier = 'TIER_1' | 'TIER_2' | 'BP_LEVEL_2'

export interface ResolutionActionDef {
  tier: ResolutionTier
  label: string
  /** Patient-facing description of what this action means clinically. */
  description?: string
  requiresRationale: boolean
  triggersBpL2Retry?: boolean
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
}

/** AlertTier (DB enum) → ResolutionTier (catalog grouping). */
export function resolutionTierFor(tier: AlertTier | string | null): ResolutionTier | null {
  switch (tier) {
    case 'TIER_1_CONTRAINDICATION':
    // Cluster 8 (Manisha 5/18/26, P0) — angioedema is non-dismissible and
    // "resolved like all Tier 1 alerts" with 15-field audit rationale.
    // Same resolution catalog (TIER1_FALSE_POSITIVE,
    // TIER1_MEDICATION_CORRECTED, etc.) as the Tier 1 contraindication.
    case 'TIER_1_ANGIOEDEMA':
      return 'TIER_1'
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
): Promise<{ status: 'RESOLVED' | 'OPEN'; resolvedAt: string | null; retryScheduledFor?: string }> {
  const res = await fetchWithAuth(`${API}/api/admin/alerts/${alertId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolutionAction: action, resolutionRationale: rationale }),
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
