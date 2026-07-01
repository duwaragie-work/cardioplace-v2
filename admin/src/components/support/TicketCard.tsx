'use client';

import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import type { SupportTicketRow } from '@/lib/services/support.service';

const STATUS_STYLE: Record<string, string> = {
  OPEN: 'bg-amber-50 text-amber-700 border-amber-200',
  IN_PROGRESS: 'bg-violet-50 text-violet-700 border-violet-200',
  RESOLVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};
const PRIORITY_STYLE: Record<string, string> = {
  HIGH: 'bg-red-50 text-red-700 border-red-200',
  NORMAL: 'bg-slate-50 text-slate-600 border-slate-200',
  LOW: 'bg-slate-50 text-slate-500 border-slate-200',
};

function formatDisplayId(value: string): string {
  if (value.length !== 13 || value.includes('-')) return value;
  return `${value.slice(0, 2)}-${value.slice(2, 5)}-${value.slice(5, 12)}-${value.slice(12)}`;
}

export default function TicketCard({ ticket }: { ticket: SupportTicketRow }) {
  return (
    <Link
      href={`/support/${ticket.id}`}
      data-testid={`support-row-${ticket.ticketNumber}`}
      className="flex items-start gap-3 px-4 py-3 border-t first:border-t-0 border-slate-100 hover:bg-slate-50 transition"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[11px] text-slate-400">{ticket.ticketNumber}</span>
          {ticket.status === 'OPEN' && (
            <span
              data-testid="support-ack-badge"
              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-700"
            >
              <AlertCircle className="w-3 h-3" /> New
            </span>
          )}
        </div>
        <p className="text-[13px] font-semibold text-slate-800 truncate">{ticket.subject}</p>
        <p className="text-[11px] text-slate-500 truncate">
          {ticket.email}
          {ticket.user?.name ? ` · ${ticket.user.name}` : ''}
          {ticket.user?.displayId ? ` · ${formatDisplayId(ticket.user.displayId)}` : ''}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[ticket.status] ?? STATUS_STYLE.OPEN}`}>
          {ticket.status.replace('_', ' ')}
        </span>
        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${PRIORITY_STYLE[ticket.priority] ?? PRIORITY_STYLE.NORMAL}`}>
          {ticket.priority}
        </span>
        {!ticket.identityVerified && (
          <span className="text-[10px] text-slate-400">unverified</span>
        )}
      </div>
    </Link>
  );
}
