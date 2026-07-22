// Support System Phase 1 — patient client. Signed-in contact goes through
// fetchWithAuth; the locked-out form is unauthenticated (plain fetch).
// Backend: backend/src/support/support.controller.ts (/api/v2/support/*)
import { fetchWithAuth } from './token';

const API = process.env.NEXT_PUBLIC_API_URL;

export type SupportCategory = 'ACCOUNT' | 'MFA' | 'CLINICAL' | 'BUG' | 'OTHER';

/**
 * The server refused a CLINICAL ticket (422 + `CLINICAL_DEFLECTED`) because a
 * medical question must reach the care team, never the ops queue. The UI should
 * already have intercepted this client-side; this is the defense-in-depth path,
 * so it carries a distinct type rather than a generic Error string.
 *
 * Mirrors the typed-error precedent in journal.service.ts
 * (`ClinicalIntakeRequiredError` etc. — a `readonly code` + a status branch).
 */
export class ClinicalDeflectedError extends Error {
  readonly code = 'CLINICAL_DEFLECTED';
  constructor(message?: string) {
    super(message || 'This looks like a medical question.');
    this.name = 'ClinicalDeflectedError';
  }
}

/** Signed-in patient raising a ticket. */
export async function submitContact(input: {
  subject: string;
  body: string;
  category: SupportCategory;
  contactPreference?: 'EMAIL' | 'PHONE';
}): Promise<{ ticketNumber: string }> {
  const res = await fetchWithAuth(`${API}/api/v2/support/contact`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as {
      message?: string;
      code?: string;
    };
    // Preserve the machine-readable clinical signal — a plain Error would
    // flatten it into a string the redirect UI can't key on.
    if (res.status === 422 && e?.code === 'CLINICAL_DEFLECTED') {
      throw new ClinicalDeflectedError(e?.message);
    }
    throw new Error(e?.message || 'Could not send your message.');
  }
  return (await res.json()) as { ticketNumber: string };
}

/**
 * Public, non-PHI "send us a message" from the signed-out hub. No auth (plain
 * fetch), rate-limited 5/IP/hour server-side. Category is forced to OTHER by
 * the backend, so a signed-out visitor can never file a clinical ticket.
 */
export async function submitPublicContact(input: {
  email: string;
  subject: string;
  message: string;
}): Promise<{ ticketNumber: string }> {
  const res = await fetch(`${API}/api/v2/support/public-contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('Too many requests. Please try again in a little while.');
    }
    const e = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(e?.message || 'Could not send your message.');
  }
  return (await res.json()) as { ticketNumber: string };
}

export type SupportTicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

/** Whose turn it is — derived server-side from the last reply's author, never
 *  stored. Null when the ticket is new, resolved, or closed. */
export type AwaitingParty = 'PATIENT' | 'OPS' | null;

export interface MyTicketReply {
  authorType: 'USER' | 'OPS';
  body: string;
  sentAt: string;
}
export interface MyTicket {
  id: string;
  ticketNumber: string;
  category: SupportCategory;
  subject: string;
  body: string;
  status: SupportTicketStatus;
  createdAt: string;
  resolvedAt: string | null;
  reopenedAt: string | null;
  closedAt: string | null;
  awaitingParty: AwaitingParty;
  replies: MyTicketReply[];
}

/** The signed-in user's own support tickets + reply threads (Fix 9). */
export async function listMyTickets(): Promise<{ data: MyTicket[] }> {
  const res = await fetchWithAuth(`${API}/api/v2/support/tickets/mine`);
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(e?.message || 'Could not load your requests.');
  }
  return (await res.json()) as { data: MyTicket[] };
}

/**
 * Patient adds an in-thread reply to their own active ticket. The server keeps
 * the ticket IN_PROGRESS and flips the derived `awaitingParty` to OPS.
 * A resolved/closed ticket is refused with 400 — reopen it first.
 */
export async function replyToTicket(
  ticketId: string,
  body: string,
): Promise<MyTicketReply> {
  const res = await fetchWithAuth(
    `${API}/api/v2/support/tickets/${ticketId}/reply`,
    { method: 'POST', body: JSON.stringify({ body }) },
  );
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(e?.message || 'Could not send your reply.');
  }
  return (await res.json()) as MyTicketReply;
}

/**
 * Patient reopens their own RESOLVED ticket, returning it to IN_PROGRESS.
 * Only valid inside the reopen window (see REOPEN_WINDOW_DAYS); the server
 * refuses with 400 once it has lapsed or the ticket is CLOSED.
 */
export async function reopenTicket(ticketId: string): Promise<MyTicket> {
  const res = await fetchWithAuth(
    `${API}/api/v2/support/tickets/${ticketId}/reopen`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(e?.message || 'Could not reopen this request.');
  }
  return (await res.json()) as MyTicket;
}

/**
 * Patient confirms a resolved request is done → CLOSED, instead of waiting out
 * the 14-day auto-close sweep. RESOLVED-only; the server refuses anything else.
 */
export async function closeTicket(ticketId: string): Promise<MyTicket> {
  const res = await fetchWithAuth(
    `${API}/api/v2/support/tickets/${ticketId}/close`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(e?.message || 'Could not close this request.');
  }
  return (await res.json()) as MyTicket;
}

/**
 * Mirrors REOPEN_WINDOW_MS in backend/src/support/support.service.ts. Used only
 * to decide whether to OFFER the reopen button — the server is the authority
 * and re-checks it, so a stale client can never actually reopen out of window.
 */
export const REOPEN_WINDOW_DAYS = 7;

/** Is this ticket still reopenable? (RESOLVED and inside the 7-day window.) */
export function canReopen(ticket: MyTicket): boolean {
  if (ticket.status !== 'RESOLVED' || !ticket.resolvedAt) return false;
  const ageMs = Date.now() - new Date(ticket.resolvedAt).getTime();
  return ageMs <= REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** Public "I can't sign in" form. No auth — rate-limited server-side by IP. */
export async function submitLockedOut(input: {
  email: string;
  description: string;
}): Promise<{ ticketNumber: string }> {
  const res = await fetch(`${API}/api/v2/support/locked-out`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('Too many requests. Please try again in a little while.');
    }
    const e = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(e?.message || 'Could not submit your request.');
  }
  return (await res.json()) as { ticketNumber: string };
}
