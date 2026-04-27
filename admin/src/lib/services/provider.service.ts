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
