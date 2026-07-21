'use client';

// Patient self-service ticket history + the in-thread lifecycle.
//
// This is where the redesign's core fix lands: the patient can now REPLY inside
// the thread (previously replies landed in the ops inbox, outside the ticket)
// and REOPEN a resolved request within the 7-day window. Authenticated route —
// deliberately kept gated by proxy.ts's PRIVATE_ROUTE_EXCEPTIONS even though the
// parent `/support` hub is public, because this renders a patient's own threads.

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ArrowLeft, CheckCircle2, Inbox, RotateCcw, Send } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/contexts/ToastContext';
import {
  canReopen,
  closeTicket,
  listMyTickets,
  replyToTicket,
  reopenTicket,
  type MyTicket,
} from '@/lib/services/support.service';

const STATUS_CLS: Record<MyTicket['status'], string> = {
  OPEN: 'bg-amber-50 text-amber-700 border-amber-200',
  IN_PROGRESS: 'bg-blue-50 text-blue-700 border-blue-200',
  RESOLVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  // Terminal — auto-closed 14 days after resolve. Muted so it reads as archive.
  CLOSED: 'bg-slate-100 text-slate-500 border-slate-200',
};

/** A thread only accepts replies while it is still active. */
const isActive = (s: MyTicket['status']) => s === 'OPEN' || s === 'IN_PROGRESS';

export default function MyTicketsPage() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [tickets, setTickets] = useState<MyTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Per-thread composer state, keyed by ticket id so two open threads can't
  // clobber each other's draft.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await listMyTickets();
    setTickets(r.data);
    return r.data;
  }, []);

  useEffect(() => {
    let alive = true;
    listMyTickets()
      .then((r) => {
        if (!alive) return;
        setTickets(r.data);
        // Deep-link from a SUPPORT_* notification: /support/my-tickets?ticket=<id>
        // Read window.location directly so this page needs no Suspense boundary.
        const wanted = new URLSearchParams(window.location.search).get('ticket');
        if (wanted && r.data.some((x) => x.id === wanted)) setOpenId(wanted);
      })
      .catch((e) => {
        // Empty string = render the generic (translated) error — keeps t() out
        // of the effect so it needs no dependency.
        if (alive) setError(e instanceof Error ? e.message : '');
      });
    return () => {
      alive = false;
    };
  }, []);

  const statusLabel = (st: MyTicket['status']) =>
    st === 'OPEN'
      ? t('support.mytickets.statusOpen')
      : st === 'IN_PROGRESS'
        ? t('support.mytickets.statusInProgress')
        : st === 'CLOSED'
          ? t('support.mytickets.statusClosed')
          : t('support.mytickets.statusResolved');

  async function sendReply(ticket: MyTicket) {
    const body = (drafts[ticket.id] ?? '').trim();
    if (!body) return;
    setBusyId(ticket.id);
    setRowError(null);
    try {
      await replyToTicket(ticket.id, body);
      setDrafts((d) => ({ ...d, [ticket.id]: '' }));
      await load();
      showToast(t('support.mytickets.replySent'));
    } catch (e) {
      setRowError(
        e instanceof Error ? e.message : t('support.mytickets.replyError'),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function doReopen(ticket: MyTicket) {
    setBusyId(ticket.id);
    setRowError(null);
    try {
      await reopenTicket(ticket.id);
      await load();
      showToast(t('support.mytickets.reopened'));
    } catch (e) {
      setRowError(
        e instanceof Error ? e.message : t('support.mytickets.reopenError'),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function doClose(ticket: MyTicket) {
    setBusyId(ticket.id);
    setRowError(null);
    try {
      await closeTicket(ticket.id);
      await load();
      showToast(t('support.mytickets.closed'));
    } catch (e) {
      setRowError(
        e instanceof Error ? e.message : t('support.mytickets.closeError'),
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main id="main" className="min-h-[100dvh] px-4 py-8" style={{ backgroundColor: '#FAFBFF' }}>
      <div className="w-full max-w-2xl mx-auto">
        <a
          href="/support"
          className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-700 mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> {t('support.mytickets.back')}
        </a>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">{t('support.mytickets.title')}</h1>
        <p className="text-[13px] text-slate-500 mb-6">{t('support.mytickets.subtitle')}</p>

        {error !== null && (
          <p className="text-[13px] text-red-600">{error || t('support.mytickets.error')}</p>
        )}
        {!tickets && error === null && (
          <div className="flex items-center gap-2 text-slate-400 text-[13px]">
            <Loader2 className="w-4 h-4 animate-spin" /> {t('support.mytickets.loading')}
          </div>
        )}
        {tickets && tickets.length === 0 && (
          <div
            data-testid="my-tickets-empty"
            className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-slate-500"
          >
            <Inbox className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p className="text-[13px]">{t('support.mytickets.empty')}</p>
          </div>
        )}

        <div className="space-y-3">
          {tickets?.map((ticket) => {
            const expanded = openId === ticket.id;
            const busy = busyId === ticket.id;
            return (
              <div
                key={ticket.id}
                data-testid="my-ticket-row"
                className="rounded-2xl bg-white border border-slate-200 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpenId(expanded ? null : ticket.id)}
                  className="w-full text-left p-4 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] text-slate-400">{ticket.ticketNumber}</p>
                    <p className="text-[14px] font-semibold text-slate-800 truncate">
                      {ticket.subject}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {ticket.category} · {new Date(ticket.createdAt).toLocaleDateString()}
                      {ticket.replies.length > 0 &&
                        ` · ${ticket.replies.length} ${t('support.mytickets.replies')}`}
                    </p>
                  </div>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_CLS[ticket.status]}`}
                    >
                      {statusLabel(ticket.status)}
                    </span>
                    {/* Derived server-side from the last reply's author — there
                        is no stored "awaiting reply" status. */}
                    {ticket.awaitingParty === 'PATIENT' && (
                      <span
                        data-testid="my-ticket-your-turn"
                        className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-[#7B00E0]"
                      >
                        {t('support.mytickets.yourTurn')}
                      </span>
                    )}
                  </span>
                </button>
                {expanded && (
                  <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/50">
                    <div className="text-[13px] text-slate-700 whitespace-pre-wrap">
                      {ticket.body}
                    </div>
                    {ticket.replies.map((r, i) => (
                      <div
                        key={`${ticket.id}-${r.sentAt}-${i}`}
                        className={`text-[13px] rounded-xl p-3 ${
                          r.authorType === 'OPS'
                            ? 'bg-white border border-slate-200'
                            : 'bg-[#f3e8ff]/50'
                        }`}
                      >
                        <p className="text-[11px] font-semibold text-slate-500 mb-1">
                          {r.authorType === 'OPS'
                            ? t('support.mytickets.support')
                            : t('support.mytickets.you')}{' '}
                          · {new Date(r.sentAt).toLocaleString()}
                        </p>
                        <p className="whitespace-pre-wrap text-slate-700">{r.body}</p>
                      </div>
                    ))}

                    {rowError && busyId === null && (
                      <p className="text-[13px] text-red-600">{rowError}</p>
                    )}

                    {/* In-thread reply — only while the ticket is active. The
                        server also refuses a reply on RESOLVED/CLOSED (400). */}
                    {isActive(ticket.status) && (
                      <div className="space-y-2">
                        <textarea
                          value={drafts[ticket.id] ?? ''}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [ticket.id]: e.target.value }))
                          }
                          rows={3}
                          placeholder={t('support.mytickets.replyPlaceholder')}
                          aria-label={t('support.mytickets.replyPlaceholder')}
                          data-testid="my-ticket-reply-input"
                          className="w-full resize-y rounded-xl border border-slate-200 p-3 text-[13px] outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => sendReply(ticket)}
                          disabled={busy || !(drafts[ticket.id] ?? '').trim()}
                          data-testid="my-ticket-reply-submit"
                          className="inline-flex h-10 items-center gap-2 rounded-full bg-[#7B00E0] px-5 text-[13px] font-semibold text-white transition-colors hover:bg-[#6600BC] disabled:opacity-50"
                        >
                          <Send className="h-3.5 w-3.5" />
                          {busy
                            ? t('support.mytickets.replySending')
                            : t('support.mytickets.replySend')}
                        </button>
                      </div>
                    )}

                    {ticket.status === 'RESOLVED' && (
                      <div className="space-y-2">
                        <p className="flex items-center gap-1 text-[12px] text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" />{' '}
                          {t('support.mytickets.resolvedNote')}
                        </p>
                        {/* Two ways out of RESOLVED, matching the agreed
                            lifecycle: confirm it's done (→ CLOSED now), or
                            reopen. Reopen is offered only inside the 7-day
                            window; the server re-checks both, so a stale tab
                            can't bypass either. */}
                        <p className="text-[12px] text-slate-500">
                          {canReopen(ticket)
                            ? t('support.mytickets.reopenNote')
                            : t('support.mytickets.closeNote')}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => doClose(ticket)}
                            disabled={busy}
                            data-testid="my-ticket-close"
                            className="inline-flex h-10 items-center gap-2 rounded-full bg-[#7B00E0] px-5 text-[13px] font-semibold text-white transition-colors hover:bg-[#6600BC] disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {busy
                              ? t('support.mytickets.closing')
                              : t('support.mytickets.close')}
                          </button>
                          {canReopen(ticket) && (
                            <button
                              type="button"
                              onClick={() => doReopen(ticket)}
                              disabled={busy}
                              data-testid="my-ticket-reopen"
                              className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-300 px-5 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              {busy
                                ? t('support.mytickets.reopening')
                                : t('support.mytickets.reopen')}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {ticket.status === 'CLOSED' && (
                      <p className="text-[12px] text-slate-500">
                        {t('support.mytickets.closedNote')}
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
