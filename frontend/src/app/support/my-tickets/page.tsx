'use client';

// Patient self-service ticket history (Fix 9). Authenticated route (guarded by
// proxy.ts — NOT in PUBLIC_ROUTES). Lists the signed-in user's own requests +
// reply threads so they can check status instead of hitting a dead-end after
// submitting the contact form.

import { useEffect, useState } from 'react';
import { Loader2, ArrowLeft, CheckCircle2, Inbox } from 'lucide-react';
import { listMyTickets, type MyTicket } from '@/lib/services/support.service';

const STATUS_STYLE: Record<MyTicket['status'], { label: string; cls: string }> = {
  OPEN: { label: 'Open', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  IN_PROGRESS: { label: 'In progress', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  RESOLVED: { label: 'Resolved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

export default function MyTicketsPage() {
  const [tickets, setTickets] = useState<MyTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listMyTickets()
      .then((r) => {
        if (alive) setTickets(r.data);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load your requests.');
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main id="main" className="min-h-[100dvh] px-4 py-8" style={{ backgroundColor: '#FAFBFF' }}>
      <div className="w-full max-w-2xl mx-auto">
        <a
          href="/settings"
          className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-700 mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to settings
        </a>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">My support requests</h1>
        <p className="text-[13px] text-slate-500 mb-6">
          Track the status of requests you’ve sent our team.
        </p>

        {error && <p className="text-[13px] text-red-600">{error}</p>}
        {!tickets && !error && (
          <div className="flex items-center gap-2 text-slate-400 text-[13px]">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}
        {tickets && tickets.length === 0 && (
          <div
            data-testid="my-tickets-empty"
            className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-slate-500"
          >
            <Inbox className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p className="text-[13px]">You haven’t sent any requests yet.</p>
          </div>
        )}

        <div className="space-y-3">
          {tickets?.map((t) => {
            const s = STATUS_STYLE[t.status];
            const expanded = openId === t.id;
            return (
              <div
                key={t.id}
                data-testid="my-ticket-row"
                className="rounded-2xl bg-white border border-slate-200 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpenId(expanded ? null : t.id)}
                  className="w-full text-left p-4 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] text-slate-400">{t.ticketNumber}</p>
                    <p className="text-[14px] font-semibold text-slate-800 truncate">{t.subject}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {t.category} · {new Date(t.createdAt).toLocaleDateString()}
                      {t.replies.length > 0 &&
                        ` · ${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}`}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${s.cls}`}
                  >
                    {s.label}
                  </span>
                </button>
                {expanded && (
                  <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/50">
                    <div className="text-[13px] text-slate-700 whitespace-pre-wrap">{t.body}</div>
                    {t.replies.map((r, i) => (
                      <div
                        key={i}
                        className={`text-[13px] rounded-xl p-3 ${
                          r.authorType === 'OPS'
                            ? 'bg-white border border-slate-200'
                            : 'bg-[#f3e8ff]/50'
                        }`}
                      >
                        <p className="text-[11px] font-semibold text-slate-500 mb-1">
                          {r.authorType === 'OPS' ? 'Support' : 'You'} ·{' '}
                          {new Date(r.sentAt).toLocaleString()}
                        </p>
                        <p className="whitespace-pre-wrap text-slate-700">{r.body}</p>
                      </div>
                    ))}
                    {t.status === 'RESOLVED' && (
                      <p className="flex items-center gap-1 text-[12px] text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5" /> This request was resolved.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
