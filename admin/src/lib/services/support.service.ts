// Support System Phase 1 — admin client. Wraps the ops-facing endpoints.
// Backend: backend/src/support/admin-support.controller.ts (/api/v2/admin/support/*)
// + the shared contact endpoint (/api/v2/support/contact) for the staff form.
import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export type SupportStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
/** Whose turn it is — derived server-side from the last reply's author, never
 *  stored. Null when the ticket is new, resolved, or closed. */
export type AwaitingParty = 'PATIENT' | 'OPS' | null
export type SupportPriority = 'LOW' | 'NORMAL' | 'HIGH'
export type SupportCategory = 'ACCOUNT' | 'MFA' | 'CLINICAL' | 'BUG' | 'OTHER'
export type SupportAction = 'mfa-reset' | 'recovery-codes-regen' | 'webauthn-reset'

export interface SupportTicketRow {
  id: string
  ticketNumber: string
  email: string
  category: SupportCategory
  subject: string
  status: SupportStatus
  priority: SupportPriority
  identityVerified: boolean
  assignedToOpsId: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  awaitingParty: AwaitingParty
  user: { name: string | null; displayId: string | null } | null
}

export interface SupportTicketReply {
  id: string
  authorType: 'USER' | 'OPS'
  body: string
  sentAt: string
}
export interface SupportTicketActionRow {
  id: string
  actionType: string
  opsUserId: string
  metadata: unknown
  performedAt: string
}

export interface SupportTicketDetail extends Omit<SupportTicketRow, 'user'> {
  body: string
  userId: string | null
  user: {
    id: string
    name: string | null
    displayId: string | null
    email: string | null
    accountStatus: string
    roles: string[]
    mfaEnrolled: boolean
    recoveryCodesRemaining: number
    webAuthnCount: number
  } | null
  replies: SupportTicketReply[]
  actions: SupportTicketActionRow[]
}

export interface TicketListResponse {
  data: SupportTicketRow[]
  total: number
  page: number
  limit: number
}

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(err?.message || `${fallback}: ${res.status}`)
  }
  return (await res.json()) as T
}

export async function listTickets(
  query: {
    status?: string
    category?: string
    priority?: string
    search?: string
    page?: number
    limit?: number
  } = {},
): Promise<TicketListResponse> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== '') qs.set(k, String(v))
  }
  const res = await fetchWithAuth(
    `${API}/api/v2/admin/support/tickets?${qs.toString()}`,
  )
  return jsonOrThrow(res, 'Could not load support tickets')
}

export async function getTicket(id: string): Promise<SupportTicketDetail> {
  const res = await fetchWithAuth(`${API}/api/v2/admin/support/tickets/${id}`)
  return jsonOrThrow(res, 'Could not load ticket')
}

export async function replyTicket(id: string, body: string): Promise<void> {
  const res = await fetchWithAuth(
    `${API}/api/v2/admin/support/tickets/${id}/reply`,
    { method: 'POST', body: JSON.stringify({ body }) },
  )
  await jsonOrThrow(res, 'Could not send reply')
}

export async function verifyIdentity(
  id: string,
  rationale: string,
): Promise<void> {
  const res = await fetchWithAuth(
    `${API}/api/v2/admin/support/tickets/${id}/verify-identity`,
    { method: 'POST', body: JSON.stringify({ rationale }) },
  )
  await jsonOrThrow(res, 'Could not record identity verification')
}

export async function resolveTicket(
  id: string,
  resolutionNotes?: string,
): Promise<void> {
  const res = await fetchWithAuth(
    `${API}/api/v2/admin/support/tickets/${id}/resolve`,
    { method: 'POST', body: JSON.stringify({ resolutionNotes }) },
  )
  await jsonOrThrow(res, 'Could not resolve ticket')
}

export async function runTicketAction(
  id: string,
  action: SupportAction,
  reason?: string,
): Promise<void> {
  const res = await fetchWithAuth(
    `${API}/api/v2/admin/support/tickets/${id}/actions/${action}`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  )
  await jsonOrThrow(res, 'Action failed')
}

// Staff (signed-in) contact form → shared /v2/support/contact.
export async function submitStaffContact(input: {
  subject: string
  body: string
  category: SupportCategory
  contactPreference?: 'EMAIL' | 'PHONE'
}): Promise<{ ticketNumber: string }> {
  const res = await fetchWithAuth(`${API}/api/v2/support/contact`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return jsonOrThrow(res, 'Could not send your message')
}
