// HIPAA audit console (L1/L2, §164.312(b)) admin client.
// Backend: backend/src/auth/auth.controller.ts (/api/v2/auth/training-ack).
// L2 will extend this with the AccessLog / AuthLog read endpoints.
import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export interface TrainingAckStatus {
  /** True only when the reviewer has acknowledged the CURRENT ROB version. */
  acknowledged: boolean
  /** The current Rules-of-Behavior version the reviewer is being held to. */
  version: string
  /** When the current-version acknowledgment was recorded (null if none). */
  ackedAt: string | null
}

/** GET the signed-in reviewer's Rules-of-Behavior acknowledgment status. */
export async function getTrainingAckStatus(): Promise<TrainingAckStatus> {
  const res = await fetchWithAuth(`${API}/api/v2/auth/training-ack`)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

/** POST — record that the reviewer acknowledges the current Rules of Behavior. */
export async function acknowledgeTraining(): Promise<{ recorded: boolean; version: string }> {
  const res = await fetchWithAuth(`${API}/api/v2/auth/training-ack`, { method: 'POST' })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

// ─── Audit-log reads (L2 — the "examine" half of §164.312(b)) ────────────────

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

/** One PHI-access row (AccessLog). */
export interface AccessLogRow {
  id: string
  actorId: string | null
  actorType: string
  action: string
  modelName: string
  recordId: string | null
  ip: string | null
  userAgent: string | null
  systemActorLabel: string | null
  createdAt: string
}

/** One auth-event row (AuthLog). */
export interface AuthLogRow {
  id: string
  event: string
  identifier: string | null
  userId: string | null
  method: string | null
  ipAddress: string | null
  userAgent: string | null
  success: boolean
  errorCode: string | null
  practiceContext: string | null
  createdAt: string
}

export interface AccessLogFilters {
  actorId?: string
  actorType?: string
  action?: string
  modelName?: string
  recordId?: string
  from?: string
  to?: string
  page?: number
  limit?: number
}

export interface AuthLogFilters {
  event?: string
  userId?: string
  identifier?: string
  success?: string
  practiceContext?: string
  from?: string
  to?: string
  page?: number
  limit?: number
}

/** Serialize defined, non-empty filters into a query string. */
function toQuery(filters: AccessLogFilters | AuthLogFilters): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') qs.append(k, String(v))
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

/** GET a paginated page of PHI-access rows (AccessLog). */
export async function getAccessLogs(
  filters: AccessLogFilters = {},
): Promise<Paginated<AccessLogRow>> {
  const res = await fetchWithAuth(`${API}/api/v2/admin/audit/access-log${toQuery(filters)}`)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

/** GET a paginated page of auth-event rows (AuthLog). */
export async function getAuthLogs(
  filters: AuthLogFilters = {},
): Promise<Paginated<AuthLogRow>> {
  const res = await fetchWithAuth(`${API}/api/v2/admin/audit/auth-log${toQuery(filters)}`)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}
