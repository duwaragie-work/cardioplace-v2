'use client';

import { useState } from 'react';
import { UserCheck, Flag } from 'lucide-react';
import type { SupportPriority } from '@/lib/services/support.service';

const PRIORITIES: SupportPriority[] = ['HIGH', 'NORMAL', 'LOW'];

/**
 * Ops triage controls — assign-to-me and priority re-triage (S4/S5).
 *
 * The backend endpoints existed with no UI, so a ticket could never actually be
 * picked up: `assignedToOpsId` stayed null forever and the priority-ordered
 * queue could only ever reflect the priority set at intake. Both actions write
 * a SupportTicketAction, so they show up in the timeline below.
 *
 * Assigning an OPEN ticket also advances it to IN_PROGRESS server-side — picking
 * work up IS starting it, and making the agent do both was busywork.
 */
export default function TriageBar({
  assignedToOpsId,
  assignedToOpsName,
  priority,
  onAssignToMe,
  onChangePriority,
}: {
  assignedToOpsId: string | null;
  /** Resolved ops-user name. Falls back to the id only if the name is missing,
   *  so the agent sees "Dr. Elena Reyes", never a raw ULID. */
  assignedToOpsName?: string | null;
  priority: SupportPriority;
  onAssignToMe: () => Promise<void> | void;
  onChangePriority: (p: SupportPriority) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void> | void) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4"
      data-testid="support-triage-bar"
    >
      <div className="flex items-center gap-2">
        <UserCheck className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Assignee
        </span>
        {assignedToOpsId ? (
          <span
            data-testid="support-assignee"
            className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700"
          >
            {assignedToOpsName ?? assignedToOpsId}
          </span>
        ) : (
          <span className="text-[12px] text-slate-400">Unassigned</span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => run(onAssignToMe)}
          data-testid="support-assign-me"
          className="rounded-full border border-slate-300 px-3 py-1 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          Assign to me
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Flag className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Priority
        </span>
        <select
          value={priority}
          disabled={busy}
          onChange={(e) => run(() => onChangePriority(e.target.value as SupportPriority))}
          aria-label="Ticket priority"
          data-testid="support-priority-select"
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] outline-none disabled:opacity-50"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
