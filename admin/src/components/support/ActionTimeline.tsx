'use client';

import { History } from 'lucide-react';
import type { SupportTicketActionRow } from '@/lib/services/support.service';

const LABELS: Record<string, string> = {
  MFA_RESET: 'MFA reset',
  RECOVERY_CODES_REGEN: 'Recovery codes regenerated',
  WEBAUTHN_RESET: 'WebAuthn reset',
  ACCOUNT_UNLOCKED: 'Account unlocked',
  IDENTITY_VERIFIED: 'Identity verified',
  RESOLVED: 'Resolved',
  ASSIGNED: 'Assigned',
  PRIORITY_CHANGED: 'Priority changed',
};

/**
 * Patient reopen / close (and the cron auto-close) are NOT SupportTicketAction
 * rows — that table is ops-only, every row carries an opsUserId. They are
 * recorded as `reopenedAt` / `closedAt` on the ticket. Without merging them in,
 * the timeline stops at "Resolved" and an agent looking at a CLOSED, once-
 * reopened ticket sees no trace of either event.
 */
type TimelineEntry = { key: string; label: string; at: string };

function buildEntries(
  actions: SupportTicketActionRow[],
  lifecycle: { reopenedAt?: string | null; closedAt?: string | null },
): TimelineEntry[] {
  const entries: TimelineEntry[] = actions.map((a) => ({
    key: a.id,
    label: LABELS[a.actionType] ?? a.actionType,
    at: a.performedAt,
  }));
  if (lifecycle.reopenedAt) {
    entries.push({
      key: 'lifecycle-reopened',
      label: 'Reopened by patient',
      at: lifecycle.reopenedAt,
    });
  }
  if (lifecycle.closedAt) {
    entries.push({ key: 'lifecycle-closed', label: 'Closed', at: lifecycle.closedAt });
  }
  return entries.sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
}

export default function ActionTimeline({
  actions,
  reopenedAt = null,
  closedAt = null,
}: {
  actions: SupportTicketActionRow[];
  reopenedAt?: string | null;
  closedAt?: string | null;
}) {
  const entries = buildEntries(actions, { reopenedAt, closedAt });
  if (!entries.length) return null;
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4" data-testid="support-action-timeline">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-3">
        <History className="w-3.5 h-3.5" /> Action timeline
      </p>
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.key} className="flex items-center justify-between text-[12px]">
            <span className="font-medium text-slate-700">{e.label}</span>
            <span className="text-slate-400">
              {new Date(e.at).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
