// Support System Phase 1 — patient client. Signed-in contact goes through
// fetchWithAuth; the locked-out form is unauthenticated (plain fetch).
// Backend: backend/src/support/support.controller.ts (/api/v2/support/*)
import { fetchWithAuth } from './token';

const API = process.env.NEXT_PUBLIC_API_URL;

export type SupportCategory = 'ACCOUNT' | 'MFA' | 'CLINICAL' | 'BUG' | 'OTHER';

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
    const e = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(e?.message || 'Could not send your message.');
  }
  return (await res.json()) as { ticketNumber: string };
}

export type SupportTicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

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
