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

export default function ActionTimeline({
  actions,
}: {
  actions: SupportTicketActionRow[];
}) {
  if (!actions.length) return null;
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4" data-testid="support-action-timeline">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-3">
        <History className="w-3.5 h-3.5" /> Action timeline
      </p>
      <ul className="space-y-2">
        {actions.map((a) => (
          <li key={a.id} className="flex items-center justify-between text-[12px]">
            <span className="font-medium text-slate-700">
              {LABELS[a.actionType] ?? a.actionType}
            </span>
            <span className="text-slate-400">
              {new Date(a.performedAt).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
