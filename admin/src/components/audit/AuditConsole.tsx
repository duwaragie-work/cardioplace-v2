'use client';

// Audit-review console (HIPAA §164.312(b) L2). Two tabs over the append-only
// audit trail — PHI access (AccessLog) and auth events (AuthLog) — each with
// grouped filters, saved-query presets, a headed table, and server-side
// pagination. Mirrors the structure of SupportQueue. The parent /audit page
// wraps this in <AuditAccessGate/> (role + Rules-of-Behavior gate, L1).

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FileSearch, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import {
  getAccessLogs,
  getAuthLogs,
  type AccessLogFilters,
  type AccessLogRow,
  type AuthLogFilters,
  type AuthLogRow,
} from '@/lib/services/audit.service';

type Tab = 'access' | 'auth';

const PAGE_SIZE = 25;

const ACCESS_ACTIONS = ['', 'READ', 'WRITE', 'DELETE'];
const ACCESS_MODELS = [
  '',
  'User',
  'PatientProfile',
  'JournalEntry',
  'DeviationAlert',
  'Notification',
  'PatientMedication',
  'PatientThreshold',
];
const AUTH_OUTCOMES = ['', 'true', 'false'];

const ACCESS_COLUMNS = ['Time', 'Actor', 'Action', 'Model', 'Record', 'IP'];
const AUTH_COLUMNS = ['Time', 'Event', 'User / Identifier', 'Outcome', 'Practice', 'IP'];

function hoursAgoIso(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

// Saved-exception-query library — one-click filter presets. `from` is a thunk so
// "24h ago" is computed at click time. (Presets mirroring Nivakaran's N7
// exception definitions can be added here once the contract is agreed.)
const ACCESS_PRESETS: Array<{ label: string; testId: string; make: () => AccessLogFilters }> = [
  { label: 'Deletes · 24h', testId: 'preset-deletes-24h', make: () => ({ action: 'DELETE', from: hoursAgoIso(24) }) },
  { label: 'System writes · 24h', testId: 'preset-system-24h', make: () => ({ actorType: 'SYSTEM_ACTOR', action: 'WRITE', from: hoursAgoIso(24) }) },
  { label: 'Reading access · 7d', testId: 'preset-readings-7d', make: () => ({ modelName: 'JournalEntry', from: hoursAgoIso(24 * 7) }) },
];

const AUTH_PRESETS: Array<{ label: string; testId: string; make: () => AuthLogFilters }> = [
  { label: 'Failed sign-ins · 24h', testId: 'preset-failed-24h', make: () => ({ success: 'false', from: hoursAgoIso(24) }) },
  { label: 'Consent events', testId: 'preset-consent', make: () => ({ event: 'policy_acknowledged' }) },
  { label: 'Training acks', testId: 'preset-training', make: () => ({ event: 'training_acknowledged' }) },
];

export default function AuditConsole() {
  const [tab, setTab] = useState<Tab>('access');

  const [accessFilters, setAccessFilters] = useState<AccessLogFilters>({});
  const [authFilters, setAuthFilters] = useState<AuthLogFilters>({});
  const [accessPage, setAccessPage] = useState(1);
  const [authPage, setAuthPage] = useState(1);

  const [accessRows, setAccessRows] = useState<AccessLogRow[]>([]);
  const [authRows, setAuthRows] = useState<AuthLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const page = tab === 'access' ? accessPage : authPage;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'access') {
        const res = await getAccessLogs({ ...accessFilters, page: accessPage, limit: PAGE_SIZE });
        setAccessRows(res.data);
        setTotal(res.total);
      } else {
        const res = await getAuthLogs({ ...authFilters, page: authPage, limit: PAGE_SIZE });
        setAuthRows(res.data);
        setTotal(res.total);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load audit records');
    } finally {
      setLoading(false);
    }
  }, [tab, accessFilters, authFilters, accessPage, authPage]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any filter/preset change resets that tab to page 1 so the user isn't left on
  // a now-out-of-range page.
  const patchAccess = (patch: AccessLogFilters) => {
    setAccessFilters((f) => ({ ...f, ...patch }));
    setAccessPage(1);
  };
  const patchAuth = (patch: AuthLogFilters) => {
    setAuthFilters((f) => ({ ...f, ...patch }));
    setAuthPage(1);
  };
  const applyAccessPreset = (f: AccessLogFilters) => {
    setAccessFilters(f);
    setAccessPage(1);
  };
  const applyAuthPreset = (f: AuthLogFilters) => {
    setAuthFilters(f);
    setAuthPage(1);
  };
  const clear = () => {
    if (tab === 'access') {
      setAccessFilters({});
      setAccessPage(1);
    } else {
      setAuthFilters({});
      setAuthPage(1);
    }
  };

  const removeChip = (key: string) => {
    const patch = { [key]: undefined } as unknown;
    if (tab === 'access') patchAccess(patch as AccessLogFilters);
    else patchAuth(patch as AuthLogFilters);
  };

  // Currently-applied filters, rendered as removable chips so a reviewer can see
  // (and drop) exactly what's narrowing the results.
  const activeChips = useMemo(() => {
    const f = (tab === 'access' ? accessFilters : authFilters) as Record<string, unknown>;
    const labels: Record<string, string> =
      tab === 'access'
        ? { actorId: 'Actor', actorType: 'Actor type', action: 'Action', modelName: 'Model', recordId: 'Record', from: 'From', to: 'To' }
        : { event: 'Event', userId: 'User', identifier: 'Identifier', success: 'Outcome', practiceContext: 'Practice', from: 'From', to: 'To' };
    const chips: Array<{ key: string; label: string; display: string }> = [];
    for (const [key, label] of Object.entries(labels)) {
      const v = f[key];
      if (v === undefined || v === null || v === '') continue;
      let display = String(v);
      if (key === 'success') display = v === 'true' ? 'Success' : 'Failure';
      else if (key === 'from' || key === 'to') {
        const d = new Date(String(v));
        display = Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
      }
      chips.push({ key, label, display });
    }
    return chips;
  }, [tab, accessFilters, authFilters]);

  const presets = useMemo(() => (tab === 'access' ? ACCESS_PRESETS : AUTH_PRESETS), [tab]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const rowsEmpty = tab === 'access' ? accessRows.length === 0 : authRows.length === 0;
  const columns = tab === 'access' ? ACCESS_COLUMNS : AUTH_COLUMNS;

  const goPage = (next: number) => {
    if (tab === 'access') setAccessPage(next);
    else setAuthPage(next);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8" data-testid="audit-console">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
          style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
        >
          <FileSearch className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--brand-text-primary)' }}>
            Audit Review
          </h1>
          <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
            Examine the PHI-access and authentication audit trail (§164.312(b)).
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        <TabButton active={tab === 'access'} onClick={() => setTab('access')} testId="audit-tab-access">
          PHI Access
        </TabButton>
        <TabButton active={tab === 'auth'} onClick={() => setTab('auth')} testId="audit-tab-auth">
          Auth Events
        </TabButton>
      </div>

      {/* Filter panel — saved queries, grouped filters, active-filter chips */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 mb-4 space-y-4">
        {/* Saved queries */}
        <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-100">
          <span
            className="text-[10px] font-bold uppercase tracking-wider mr-1"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            Saved queries
          </span>
          {presets.map((p) => (
            <button
              key={p.testId}
              type="button"
              data-testid={`audit-${p.testId}`}
              onClick={() =>
                tab === 'access'
                  ? applyAccessPreset((p as { make: () => AccessLogFilters }).make())
                  : applyAuthPreset((p as { make: () => AuthLogFilters }).make())
              }
              className="h-8 px-3 rounded-full text-[12px] font-semibold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Grouped filters — sub-filters organized under each main label */}
        {tab === 'access' ? (
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <FilterGroup label="Who">
              <TextFilter
                value={accessFilters.actorId ?? ''}
                onChange={(v) => patchAccess({ actorId: v })}
                placeholder="Actor ID"
                testId="audit-filter-actor"
              />
            </FilterGroup>
            <FilterGroup label="What">
              <Select value={accessFilters.action ?? ''} onChange={(v) => patchAccess({ action: v })} options={ACCESS_ACTIONS} label="Action" />
              <Select value={accessFilters.modelName ?? ''} onChange={(v) => patchAccess({ modelName: v })} options={ACCESS_MODELS} label="Model" />
            </FilterGroup>
            <FilterGroup label="Which record">
              <TextFilter
                value={accessFilters.recordId ?? ''}
                onChange={(v) => patchAccess({ recordId: v })}
                placeholder="Record ID"
                testId="audit-filter-record"
              />
            </FilterGroup>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <FilterGroup label="What">
              <TextFilter
                value={authFilters.event ?? ''}
                onChange={(v) => patchAuth({ event: v })}
                placeholder="Event (e.g. login)"
                testId="audit-filter-event"
              />
            </FilterGroup>
            <FilterGroup label="Who">
              <TextFilter
                value={authFilters.identifier ?? ''}
                onChange={(v) => patchAuth({ identifier: v })}
                placeholder="User ID / email"
                testId="audit-filter-identifier"
              />
            </FilterGroup>
            <FilterGroup label="Outcome">
              <Select value={authFilters.success ?? ''} onChange={(v) => patchAuth({ success: v })} options={AUTH_OUTCOMES} label="Outcome" render={outcomeLabel} />
            </FilterGroup>
            <FilterGroup label="Where">
              <TextFilter
                value={authFilters.practiceContext ?? ''}
                onChange={(v) => patchAuth({ practiceContext: v })}
                placeholder="Practice ID"
                testId="audit-filter-practice"
              />
            </FilterGroup>
          </div>
        )}

        {/* Active (selected) filters */}
        {activeChips.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100"
            data-testid="audit-active-filters"
          >
            <span
              className="text-[10px] font-bold uppercase tracking-wider mr-1"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              Active
            </span>
            {activeChips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => removeChip(c.key)}
                data-testid={`audit-active-${c.key}`}
                aria-label={`Remove ${c.label} filter`}
                className="inline-flex items-center gap-1 h-7 pl-3 pr-2 rounded-full text-[11.5px] font-semibold transition hover:opacity-80"
                style={{
                  backgroundColor: 'var(--brand-primary-purple-light, #f5f0ff)',
                  color: 'var(--brand-primary-purple)',
                }}
              >
                {c.label}: {c.display}
                <X className="w-3 h-3" />
              </button>
            ))}
            <button
              type="button"
              onClick={clear}
              data-testid="audit-clear"
              className="text-[11.5px] font-semibold text-slate-400 hover:text-slate-600 transition ml-1"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Result count + top pagination — wrap on narrow screens so the wider
          pager (with the jump-to-page input) doesn't overflow the viewport. */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }} data-testid="audit-count">
          {loading ? 'Loading…' : total === 0 ? 'No records' : `Showing ${from}–${to} of ${total}`}
        </p>
        <Pager page={page} totalPages={totalPages} loading={loading} onPrev={() => goPage(page - 1)} onNext={() => goPage(page + 1)} onGo={goPage} />
      </div>

      {/* Table */}
      <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" data-testid="audit-table">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                {columns.map((c) => (
                  <th
                    key={c}
                    className="text-left font-bold uppercase tracking-wider px-4 py-2.5 text-[10.5px] whitespace-nowrap"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableMessage cols={columns.length}>Loading…</TableMessage>
              ) : error ? (
                <TableMessage cols={columns.length} testId="audit-error" tone="error">
                  {error}
                </TableMessage>
              ) : rowsEmpty ? (
                <TableMessage cols={columns.length} testId="audit-empty">
                  No audit records match these filters.
                </TableMessage>
              ) : tab === 'access' ? (
                accessRows.map((r) => <AccessRow key={r.id} row={r} />)
              ) : (
                authRows.map((r) => <AuthRow key={r.id} row={r} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom pagination */}
      <div className="flex items-center justify-end mt-3">
        <Pager page={page} totalPages={totalPages} loading={loading} onPrev={() => goPage(page - 1)} onNext={() => goPage(page + 1)} onGo={goPage} />
      </div>
    </div>
  );
}

function outcomeLabel(o: string): string {
  if (o === 'true') return 'Success';
  if (o === 'false') return 'Failure';
  return 'All outcomes';
}

function AccessRow({ row }: { row: AccessLogRow }) {
  const actionColor =
    row.action === 'DELETE' ? '#DC2626' : row.action === 'WRITE' ? '#7B00E0' : '#0D9488';
  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50" data-testid="audit-row">
      <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{fmt(row.createdAt)}</td>
      <td className="px-4 py-2.5 text-slate-600 max-w-[220px] truncate">
        {row.actorType === 'SYSTEM_ACTOR' ? `system: ${row.systemActorLabel ?? 'unknown'}` : row.actorId ?? '—'}
      </td>
      <td className="px-4 py-2.5 font-bold" style={{ color: actionColor }}>
        {row.action}
      </td>
      <td className="px-4 py-2.5 font-semibold text-slate-700">{row.modelName}</td>
      <td className="px-4 py-2.5 text-slate-500 max-w-[220px] truncate">{row.recordId ?? '—'}</td>
      <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{row.ip ?? '—'}</td>
    </tr>
  );
}

function AuthRow({ row }: { row: AuthLogRow }) {
  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50" data-testid="audit-row">
      <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{fmt(row.createdAt)}</td>
      <td className="px-4 py-2.5 font-semibold text-slate-700">{row.event}</td>
      <td className="px-4 py-2.5 text-slate-600 max-w-[220px] truncate">{row.userId ?? row.identifier ?? '—'}</td>
      <td className="px-4 py-2.5 font-bold" style={{ color: row.success ? '#0D9488' : '#DC2626' }}>
        {row.success ? 'OK' : 'FAIL'}
      </td>
      <td className="px-4 py-2.5 text-slate-500">{row.practiceContext ?? '—'}</td>
      <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{row.ipAddress ?? '—'}</td>
    </tr>
  );
}

function TableMessage({
  cols,
  children,
  testId,
  tone,
}: {
  cols: number;
  children: ReactNode;
  testId?: string;
  tone?: 'error';
}) {
  return (
    <tr>
      <td
        colSpan={cols}
        className={'px-4 py-10 text-center text-[13px] ' + (tone === 'error' ? 'text-red-600' : 'text-slate-400')}
        data-testid={testId}
      >
        {children}
      </td>
    </tr>
  );
}

function Pager({
  page,
  totalPages,
  loading,
  onPrev,
  onNext,
  onGo,
}: {
  page: number;
  totalPages: number;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
  onGo: (next: number) => void;
}) {
  // Local draft so the field can be typed/cleared freely; it only commits to a
  // real page change on submit (Enter or Go). Kept as a string so the user can
  // clear it mid-edit without it snapping to a number.
  const [draft, setDraft] = useState('');

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setDraft('');
      return;
    }
    // Clamp into range so "9999" on a 120-page log lands on the last page
    // instead of an empty out-of-range fetch.
    const clamped = Math.min(Math.max(parsed, 1), totalPages);
    if (clamped !== page) onGo(clamped);
    setDraft('');
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="audit-pager">
      <PagerButton disabled={loading || page <= 1} onClick={onPrev} testId="audit-prev" ariaLabel="Previous page">
        <ChevronLeft className="w-4 h-4" />
      </PagerButton>
      <span className="text-[11.5px] font-semibold tabular-nums" style={{ color: 'var(--brand-text-secondary)' }}>
        Page {page} / {totalPages}
      </span>
      <PagerButton disabled={loading || page >= totalPages} onClick={onNext} testId="audit-next" ariaLabel="Next page">
        <ChevronRight className="w-4 h-4" />
      </PagerButton>

      {/* Jump-to-page — for logs with many pages, skip clicking Next 100 times.
          Hidden when everything fits on a single page. */}
      {totalPages > 1 && (
        <form
          className="flex items-center gap-1.5 pl-1"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <label className="text-[11.5px] font-medium" style={{ color: 'var(--brand-text-secondary)' }}>
            Go to
          </label>
          <input
            type="number"
            min={1}
            max={totalPages}
            inputMode="numeric"
            value={draft}
            disabled={loading}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={String(page)}
            aria-label={`Jump to page (1 to ${totalPages})`}
            data-testid="audit-goto-input"
            className="w-14 h-8 px-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-[12px] text-center tabular-nums outline-none focus:ring-2 focus:ring-[#7B00E0] focus:border-transparent disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            type="submit"
            disabled={loading || draft.trim() === ''}
            data-testid="audit-goto-btn"
            className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-[12px] font-semibold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Go
          </button>
        </form>
      )}
    </div>
  );
}

function PagerButton({
  disabled,
  onClick,
  children,
  testId,
  ariaLabel,
}: {
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
  testId: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-label={ariaLabel}
      className="w-8 h-8 rounded-lg flex items-center justify-center border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
    >
      {children}
    </button>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wider px-1" style={{ color: 'var(--brand-text-muted)' }}>
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="h-9 px-4 rounded-full text-[13px] font-semibold transition border"
      style={{
        backgroundColor: active ? 'var(--brand-primary-purple)' : 'white',
        color: active ? 'white' : 'var(--brand-text-muted)',
        borderColor: active ? 'var(--brand-primary-purple)' : 'rgb(226 232 240)',
      }}
    >
      {children}
    </button>
  );
}

function TextFilter({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  testId: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 h-9 rounded-full bg-white border border-slate-200 min-w-[160px]">
      <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        data-testid={testId}
        className="flex-1 text-[12px] outline-none bg-transparent min-w-0"
      />
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  label,
  render,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
  render?: (o: string) => string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="h-9 px-3 rounded-full bg-white border border-slate-200 text-[12px] text-slate-600 outline-none"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {render ? render(o) : o === '' ? `All ${label.toLowerCase()}` : o}
        </option>
      ))}
    </select>
  );
}
