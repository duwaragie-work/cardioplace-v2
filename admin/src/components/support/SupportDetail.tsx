'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  assignTicket,
  changePriority,
  getTicket,
  replyTicket,
  resolveTicket,
  runTicketAction,
  verifyIdentity,
  type SupportAction,
  type SupportTicketDetail,
} from '@/lib/services/support.service';
import ReplyBox from './ReplyBox';
import IdentityVerifyToggle from './IdentityVerifyToggle';
import ActionButtons from './ActionButtons';
import ActionTimeline from './ActionTimeline';
import TriageBar from './TriageBar';

function formatDisplayId(value: string): string {
  if (value.length !== 13 || value.includes('-')) return value;
  return `${value.slice(0, 2)}-${value.slice(2, 5)}-${value.slice(5, 12)}-${value.slice(12)}`;
}

export default function SupportDetail({ ticketId }: { ticketId: string }) {
  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTicket(await getTicket(ticketId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load ticket');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function withReload(fn: () => Promise<unknown>, ok: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    }
  }

  if (loading) {
    return <p className="p-10 text-center text-[13px] text-slate-400">Loading…</p>;
  }
  if (!ticket) {
    return <p className="p-10 text-center text-[13px] text-red-600">{error ?? 'Ticket not found.'}</p>;
  }

  const isPatient = ticket.user?.roles?.includes('PATIENT') ?? false;

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-4">
      <Link
        href="/support"
        className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to queue
      </Link>

      <div className="rounded-2xl bg-white border border-slate-200 p-4">
        <p className="font-mono text-[11px] text-slate-400">{ticket.ticketNumber}</p>
        <h1 className="text-lg font-bold text-slate-800">{ticket.subject}</h1>
        <p className="text-[11px] text-slate-500">
          {ticket.category} · {ticket.priority} · {ticket.status.replace('_', ' ')}
        </p>
      </div>

      {notice && (
        <div
          className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2 text-[12px] text-emerald-800"
          data-testid="support-notice"
        >
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-2 text-[12px] text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-2xl bg-white border border-slate-200 p-4" data-testid="support-user-panel">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">
          Requester
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          <Info label="Name" value={ticket.user?.name ?? '—'} />
          <Info label="Email" value={ticket.user?.email ?? ticket.email} />
          <Info
            label="Cardioplace ID"
            value={ticket.user?.displayId ? formatDisplayId(ticket.user.displayId) : '—'}
          />
          <Info label="Account status" value={ticket.user?.accountStatus ?? '—'} />
          <Info label="MFA" value={ticket.user?.mfaEnrolled ? 'Enrolled' : 'Not enrolled'} />
          <Info
            label="Recovery codes left"
            value={String(ticket.user?.recoveryCodesRemaining ?? 0)}
          />
          <Info
            label="Passkeys (WebAuthn)"
            value={String(ticket.user?.webAuthnCount ?? 0)}
          />
        </dl>
      </div>

      <div className="rounded-2xl bg-white border border-slate-200 p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">
          Message
        </p>
        <p className="text-[13px] text-slate-700 whitespace-pre-wrap">{ticket.body}</p>
      </div>

      {ticket.replies.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Replies
          </p>
          {ticket.replies.map((r) => (
            <div
              key={r.id}
              className={`text-[13px] ${r.authorType === 'OPS' ? 'text-slate-700' : 'text-slate-500'}`}
            >
              <span className="font-semibold">
                {r.authorType === 'OPS' ? 'Support' : 'User'}
              </span>{' '}
              · {new Date(r.sentAt).toLocaleString()}
              <p className="whitespace-pre-wrap">{r.body}</p>
            </div>
          ))}
        </div>
      )}

      {/* Triage first — pick the ticket up and set its priority before acting
          on it. Both write to the action timeline below. */}
      <TriageBar
        assignedToOpsId={ticket.assignedToOpsId}
        assignedToOpsName={ticket.assignedToOps?.name ?? null}
        priority={ticket.priority}
        onAssignToMe={() =>
          withReload(() => assignTicket(ticket.id), 'Assigned to you.')
        }
        onChangePriority={(p) =>
          withReload(() => changePriority(ticket.id, p), 'Priority updated.')
        }
      />
      <IdentityVerifyToggle
        verified={ticket.identityVerified}
        onVerify={(rationale) =>
          withReload(() => verifyIdentity(ticket.id, rationale), 'Identity verified.')
        }
      />
      <ActionButtons
        locked={!ticket.identityVerified}
        isPatient={isPatient}
        resolved={ticket.status === 'RESOLVED'}
        mfaEnrolled={ticket.user?.mfaEnrolled ?? false}
        webAuthnCount={ticket.user?.webAuthnCount ?? 0}
        onAction={(a: SupportAction) =>
          withReload(() => runTicketAction(ticket.id, a), 'Action completed.')
        }
        onResolve={() =>
          withReload(() => resolveTicket(ticket.id), 'Ticket resolved.')
        }
      />
      <ReplyBox
        onSend={(b) => withReload(() => replyTicket(ticket.id, b), 'Reply sent.')}
      />
      <ActionTimeline
        actions={ticket.actions}
        reopenedAt={ticket.reopenedAt}
        closedAt={ticket.closedAt}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-slate-400">{label}</dt>
      <dd className="text-slate-700 font-medium truncate">{value}</dd>
    </div>
  );
}
