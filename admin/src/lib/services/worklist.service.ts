// L3 reviewer worklist (HIPAA §164.312(b) act + §164.308(a)(6)) admin client.
// Reads N7's AuditException rows and records triage + security-incident actions.
// Backend: backend/src/worklist/admin-worklist.controller.ts
//   GET  /api/v2/admin/worklist/exceptions
//   GET  /api/v2/admin/worklist/exceptions/:id
//   POST /api/v2/admin/worklist/exceptions/:id/{acknowledge,benign,escalate}
//   GET  /api/v2/admin/worklist/incidents[/:id]
//   POST /api/v2/admin/worklist/incidents/:id/{assign,note,resolve}
import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

export type ExceptionStatus =
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'RESOLVED'
  | 'FALSE_POSITIVE'
export type Severity = 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type DetectorId =
  | 'BULK_PHI_READ'
  | 'OFF_HOURS_PHI_ACCESS'
  | 'CROSS_PRACTICE_ACCESS'
  | 'REPEATED_FAILED_AUTH'
  | 'DROPPED_AUDIT_WRITES'
  | 'UNATTRIBUTED_SYSTEM_DISCLOSURE'

export interface ExceptionRow {
  id: string
  detectorId: DetectorId
  severity: Severity
  status: ExceptionStatus
  windowStart: string
  windowEnd: string
  summary: string
  evidence: Record<string, unknown>
  practiceContext: string | null
  acknowledgedBy: string | null
  acknowledgedAt: string | null
  benignBy: string | null
  benignAt: string | null
  benignReason: string | null
  escalatedToIncidentId: string | null
  escalatedAt: string | null
  createdAt: string
  updatedAt: string
}

export type IncidentStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'

export interface IncidentAction {
  id: string
  opsUserId: string
  actionType: 'OPENED' | 'ASSIGNED' | 'NOTE_ADDED' | 'STATUS_CHANGED' | 'RESOLVED'
  metadata: Record<string, unknown> | null
  performedAt: string
}

export interface IncidentRow {
  id: string
  status: IncidentStatus
  severity: Severity
  title: string
  summary: string
  sourceExceptionId: string | null
  sourceDetectorId: string | null
  practiceContext: string | null
  openedByOpsId: string
  assignedToOpsId: string | null
  resolutionNotes: string | null
  resolvedByOpsId: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface IncidentDetail extends IncidentRow {
  actions: IncidentAction[]
}

export interface ExceptionFilters {
  status?: string
  severity?: string
  detectorId?: string
  practiceContext?: string
  from?: string
  to?: string
  page?: number
  limit?: number
}

export interface IncidentFilters {
  status?: string
  severity?: string
  practiceContext?: string
  assignedToOpsId?: string
  from?: string
  to?: string
  page?: number
  limit?: number
}

function toQuery(filters: ExceptionFilters | IncidentFilters): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') qs.append(k, String(v))
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    let msg = `${fallback}: ${res.status}`
    try {
      const body = (await res.json()) as { message?: string }
      if (body?.message) msg = body.message
    } catch {
      /* keep fallback */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

// ─── Audit-exception worklist ────────────────────────────────────────────────

export async function getExceptions(
  filters: ExceptionFilters = {},
): Promise<Paginated<ExceptionRow>> {
  const res = await fetchWithAuth(
    `${API}/api/v2/admin/worklist/exceptions${toQuery(filters)}`,
  )
  return jsonOrThrow(res, 'Could not load exceptions')
}

export async function acknowledgeException(id: string): Promise<ExceptionRow> {
  const res = await fetchWithAuth(
    `${API}/api/v2/admin/worklist/exceptions/${id}/acknowledge`,
    { method: 'POST' },
  )
  return jsonOrThrow(res, 'Could not acknowledge')
}

export async function markBenign(
  id: string,
  reason: string,
): Promise<ExceptionRow> {
  const res = await fetchWithAuth(
    `${API}/api/v2/admin/worklist/exceptions/${id}/benign`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  )
  return jsonOrThrow(res, 'Could not mark benign')
}

export async function escalateException(
  id: string,
  body: { title?: string; severity?: Severity; notes?: string } = {},
): Promise<{ incident: IncidentRow; exception: ExceptionRow }> {
  const res = await fetchWithAuth(
    `${API}/api/v2/admin/worklist/exceptions/${id}/escalate`,
    { method: 'POST', body: JSON.stringify(body) },
  )
  return jsonOrThrow(res, 'Could not escalate')
}

// ─── Security-incident lifecycle ─────────────────────────────────────────────

export async function getIncidents(
  filters: IncidentFilters = {},
): Promise<Paginated<IncidentRow>> {
  const res = await fetchWithAuth(
    `${API}/api/v2/admin/worklist/incidents${toQuery(filters)}`,
  )
  return jsonOrThrow(res, 'Could not load incidents')
}

export async function getIncident(id: string): Promise<IncidentDetail> {
  const res = await fetchWithAuth(
    `${API}/api/v2/admin/worklist/incidents/${id}`,
  )
  return jsonOrThrow(res, 'Could not load incident')
}

export async function assignIncident(
  id: string,
  assignToOpsId?: string,
): Promise<IncidentDetail> {
  const res = await fetchWithAuth(
    `${API}/api/v2/admin/worklist/incidents/${id}/assign`,
    { method: 'POST', body: JSON.stringify({ assignToOpsId }) },
  )
  return jsonOrThrow(res, 'Could not assign')
}

export async function addIncidentNote(
  id: string,
  note: string,
): Promise<IncidentDetail> {
  const res = await fetchWithAuth(
    `${API}/api/v2/admin/worklist/incidents/${id}/note`,
    { method: 'POST', body: JSON.stringify({ note }) },
  )
  return jsonOrThrow(res, 'Could not add note')
}

export async function resolveIncident(
  id: string,
  resolutionNotes: string,
): Promise<IncidentDetail> {
  const res = await fetchWithAuth(
    `${API}/api/v2/admin/worklist/incidents/${id}/resolve`,
    { method: 'POST', body: JSON.stringify({ resolutionNotes }) },
  )
  return jsonOrThrow(res, 'Could not resolve')
}
