'use client';

// L3 reviewer worklist. Two tabs over the HIPAA audit-oversight flow:
//   • Exceptions — N7's AuditException rows; each gets Acknowledge / Mark-benign
//     / Escalate (Escalate opens a SecurityIncident, §164.308(a)(6)).
//   • Incidents  — the SecurityIncident lifecycle: assign → note → resolve, with
//     a per-incident action timeline.
// Mirrors AuditConsole: a categorized filter panel (saved queries + grouped
// filters + removable active chips) and an organized, readable detail panel.
// The /worklist page wraps this in <AuditAccessGate/> (role + ROB gate).

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import {
  getExceptions,
  acknowledgeException,
  markBenign,
  escalateException,
  getIncidents,
  getIncident,
  assignIncident,
  addIncidentNote,
  resolveIncident,
  type ExceptionRow,
  type ExceptionFilters,
  type IncidentRow,
  type IncidentDetail,
  type IncidentFilters,
} from '@/lib/services/worklist.service';

type Tab = 'exceptions' | 'incidents';

const PAGE_SIZE = 25;

const EXCEPTION_STATUSES = ['', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'];
const INCIDENT_STATUSES = ['', 'OPEN', 'IN_PROGRESS', 'RESOLVED'];
const SEVERITIES = ['', 'MEDIUM', 'HIGH', 'CRITICAL'];
const DETECTORS = [
  '',
  'BULK_PHI_READ',
  'OFF_HOURS_PHI_ACCESS',
  'CROSS_PRACTICE_ACCESS',
  'REPEATED_FAILED_AUTH',
  'DROPPED_AUDIT_WRITES',
  'UNATTRIBUTED_SYSTEM_DISCLOSURE',
];

const SEVERITY_COLOR: Record<string, string> = {
  MEDIUM: '#CA8A04',
  HIGH: '#EA580C',
  CRITICAL: '#DC2626',
};
const STATUS_COLOR: Record<string, string> = {
  OPEN: '#DC2626',
  ACKNOWLEDGED: '#2563EB',
  IN_PROGRESS: '#2563EB',
  RESOLVED: '#0D9488',
  FALSE_POSITIVE: '#64748B',
};

// Saved-query presets — one click applies a common filter set.
const EX_PRESETS: Array<{ label: string; testId: string; make: () => ExceptionFilters }> = [
  { label: 'Open', testId: 'preset-open', make: () => ({ status: 'OPEN' }) },
  { label: 'Critical · Open', testId: 'preset-critical', make: () => ({ status: 'OPEN', severity: 'CRITICAL' }) },
  { label: 'Bulk PHI reads', testId: 'preset-bulk', make: () => ({ detectorId: 'BULK_PHI_READ' }) },
];
const INC_PRESETS: Array<{ label: string; testId: string; make: () => IncidentFilters }> = [
  { label: 'Open', testId: 'preset-inc-open', make: () => ({ status: 'OPEN' }) },
  { label: 'In progress', testId: 'preset-inc-progress', make: () => ({ status: 'IN_PROGRESS' }) },
];

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function label(v: string): string {
  return v
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** camelCase / snake_case → "Title Case" for evidence keys. */
function humanizeKey(k: string): string {
  return k
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export default function Worklist() {
  const [tab, setTab] = useState<Tab>('exceptions');

  const [exFilters, setExFilters] = useState<ExceptionFilters>({});
  const [incFilters, setIncFilters] = useState<IncidentFilters>({});
  const [exPage, setExPage] = useState(1);
  const [incPage, setIncPage] = useState(1);

  const [exRows, setExRows] = useState<ExceptionRow[]>([]);
  const [incRows, setIncRows] = useState<IncidentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const page = tab === 'exceptions' ? exPage : incPage;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'exceptions') {
        const res = await getExceptions({ ...exFilters, page: exPage, limit: PAGE_SIZE });
        setExRows(res.data);
        setTotal(res.total);
      } else {
        const res = await getIncidents({ ...incFilters, page: incPage, limit: PAGE_SIZE });
        setIncRows(res.data);
        setTotal(res.total);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the worklist.');
    } finally {
      setLoading(false);
    }
  }, [tab, exFilters, incFilters, exPage, incPage]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      setExpandedId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    }
  }

  // ── Filter helpers ──────────────────────────────────────────────────────
  function patchEx(patch: Partial<ExceptionFilters>) {
    setExPage(1);
    setExFilters((f) => ({ ...f, ...patch }));
  }
  function patchInc(patch: Partial<IncidentFilters>) {
    setIncPage(1);
    setIncFilters((f) => ({ ...f, ...patch }));
  }
  function applyExPreset(f: ExceptionFilters) {
    setExPage(1);
    setExFilters(f);
  }
  function applyIncPreset(f: IncidentFilters) {
    setIncPage(1);
    setIncFilters(f);
  }
  function clearFilters() {
    if (tab === 'exceptions') {
      setExFilters({});
      setExPage(1);
    } else {
      setIncFilters({});
      setIncPage(1);
    }
  }

  const activeChips = useMemo(() => {
    const f = (tab === 'exceptions' ? exFilters : incFilters) as Record<string, unknown>;
    const labels: Record<string, string> =
      tab === 'exceptions'
        ? { status: 'Status', severity: 'Severity', detectorId: 'Detector', practiceContext: 'Practice' }
        : { status: 'Status', severity: 'Severity', practiceContext: 'Practice', assignedToOpsId: 'Assignee' };
    const chips: Array<{ key: string; label: string; display: string }> = [];
    for (const [key, lbl] of Object.entries(labels)) {
      const v = f[key];
      if (v === undefined || v === null || v === '') continue;
      chips.push({ key, label: lbl, display: label(String(v)) });
    }
    return chips;
  }, [tab, exFilters, incFilters]);

  function removeChip(key: string) {
    if (tab === 'exceptions') patchEx({ [key]: undefined } as Partial<ExceptionFilters>);
    else patchInc({ [key]: undefined } as Partial<IncidentFilters>);
  }

  const presets = tab === 'exceptions' ? EX_PRESETS : INC_PRESETS;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function switchTab(next: Tab) {
    setTab(next);
    setExpandedId(null);
    setNotice(null);
    setError(null);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8" data-testid="worklist">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0" style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}>
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--brand-text-primary)' }}>Audit Worklist</h1>
            <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
              Triage detected audit exceptions and manage security incidents (§164.312(b) · §164.308(a)(6)).
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          <TabButton active={tab === 'exceptions'} onClick={() => switchTab('exceptions')} testId="worklist-tab-exceptions">Exceptions</TabButton>
          <TabButton active={tab === 'incidents'} onClick={() => switchTab('incidents')} testId="worklist-tab-incidents">Incidents</TabButton>
        </div>

        {/* Filter panel — saved queries · grouped filters · active chips */}
        <div className="rounded-2xl bg-white border border-slate-200 p-4 mb-4 space-y-4">
          {/* Saved queries */}
          <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-100">
            <span className="text-[10px] font-bold uppercase tracking-wider mr-1" style={{ color: 'var(--brand-text-muted)' }}>Saved queries</span>
            {presets.map((p) => (
              <button
                key={p.testId}
                type="button"
                data-testid={`worklist-${p.testId}`}
                onClick={() => (tab === 'exceptions'
                  ? applyExPreset((p as { make: () => ExceptionFilters }).make())
                  : applyIncPreset((p as { make: () => IncidentFilters }).make()))}
                className="h-8 px-3 rounded-full text-[12px] font-semibold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Grouped filters */}
          {tab === 'exceptions' ? (
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <FilterGroup label="State">
                <Select testId="worklist-filter-status" value={exFilters.status ?? ''} options={EXCEPTION_STATUSES} onChange={(v) => patchEx({ status: v || undefined })} placeholder="Any status" />
              </FilterGroup>
              <FilterGroup label="Priority">
                <Select testId="worklist-filter-severity" value={exFilters.severity ?? ''} options={SEVERITIES} onChange={(v) => patchEx({ severity: v || undefined })} placeholder="Any severity" />
              </FilterGroup>
              <FilterGroup label="Kind">
                <Select testId="worklist-filter-detector" value={exFilters.detectorId ?? ''} options={DETECTORS} onChange={(v) => patchEx({ detectorId: v || undefined })} placeholder="Any detector" />
              </FilterGroup>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <FilterGroup label="State">
                <Select testId="worklist-filter-inc-status" value={incFilters.status ?? ''} options={INCIDENT_STATUSES} onChange={(v) => patchInc({ status: v || undefined })} placeholder="Any status" />
              </FilterGroup>
              <FilterGroup label="Priority">
                <Select testId="worklist-filter-inc-severity" value={incFilters.severity ?? ''} options={SEVERITIES} onChange={(v) => patchInc({ severity: v || undefined })} placeholder="Any severity" />
              </FilterGroup>
            </div>
          )}

          {/* Active chips */}
          {activeChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100" data-testid="worklist-active-filters">
              <span className="text-[10px] font-bold uppercase tracking-wider mr-1" style={{ color: 'var(--brand-text-muted)' }}>Active</span>
              {activeChips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => removeChip(c.key)}
                  aria-label={`Remove ${c.label} filter`}
                  className="inline-flex items-center gap-1 h-7 pl-3 pr-2 rounded-full text-[11.5px] font-semibold transition hover:opacity-80"
                  style={{ backgroundColor: 'var(--brand-primary-purple-light, #f5f0ff)', color: 'var(--brand-primary-purple, #7B00E0)' }}
                >
                  {c.label}: {c.display}
                  <X className="w-3 h-3" />
                </button>
              ))}
              <button type="button" onClick={clearFilters} className="text-[11.5px] font-semibold text-slate-400 hover:text-slate-600 transition ml-1">Clear all</button>
            </div>
          )}
        </div>

        {notice && <Banner tone="ok" testId="worklist-notice">{notice}</Banner>}
        {error && <Banner tone="err" testId="worklist-error">{error}</Banner>}

        {/* Card list — responsive: cards stack on mobile, no horizontal scroll */}
        <div className="flex flex-col gap-2.5" data-testid="worklist-table">
          {loading ? (
            <ListMessage>Loading…</ListMessage>
          ) : (tab === 'exceptions' ? exRows.length : incRows.length) === 0 ? (
            <ListMessage testId="worklist-empty">Nothing to review.</ListMessage>
          ) : tab === 'exceptions' ? (
            exRows.map((row) => (
              <ExceptionCard
                key={row.id}
                row={row}
                expanded={expandedId === row.id}
                onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
                onAcknowledge={() => act(() => acknowledgeException(row.id), 'Exception acknowledged.')}
                onBenign={(reason) => act(() => markBenign(row.id, reason), 'Marked as benign.')}
                onEscalate={(notes) => act(() => escalateException(row.id, { notes: notes || undefined }), 'Escalated — security incident opened.')}
              />
            ))
          ) : (
            incRows.map((row) => (
              <IncidentCard
                key={row.id}
                row={row}
                expanded={expandedId === row.id}
                onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
                onAssign={() => act(() => assignIncident(row.id), 'Assigned to you.')}
                onNote={(note) => act(() => addIncidentNote(row.id, note), 'Note added.')}
                onResolve={(notes) => act(() => resolveIncident(row.id, notes), 'Incident resolved.')}
              />
            ))
          )}
        </div>

        {/* Pager */}
        <div className="flex items-center justify-end gap-2 mt-3">
          <PagerButton disabled={loading || page <= 1} onClick={() => (tab === 'exceptions' ? setExPage((p) => p - 1) : setIncPage((p) => p - 1))} ariaLabel="Previous page">
            <ChevronLeft className="w-4 h-4" />
          </PagerButton>
          <span className="text-[11.5px] font-semibold tabular-nums text-slate-500">Page {page} of {totalPages} · {total} total</span>
          <PagerButton disabled={loading || page >= totalPages} onClick={() => (tab === 'exceptions' ? setExPage((p) => p + 1) : setIncPage((p) => p + 1))} ariaLabel="Next page">
            <ChevronRight className="w-4 h-4" />
          </PagerButton>
        </div>
      </div>
    </div>
  );
}

// ─── Exception card (+ organized detail panel) ───────────────────────────────

function ExceptionCard({
  row,
  expanded,
  onToggle,
  onAcknowledge,
  onBenign,
  onEscalate,
}: {
  row: ExceptionRow;
  expanded: boolean;
  onToggle: () => void;
  onAcknowledge: () => void;
  onBenign: (reason: string) => void;
  onEscalate: (notes: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const terminal = row.status === 'RESOLVED' || row.status === 'FALSE_POSITIVE';

  return (
    <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden" data-testid="worklist-exception-row">
      <button type="button" onClick={onToggle} className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-slate-50/60 transition">
        <span className="text-slate-400 mt-0.5 shrink-0">{expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="text-[13px] font-semibold text-slate-700">{label(row.detectorId)}</span>
            <Pill color={SEVERITY_COLOR[row.severity]}>{row.severity}</Pill>
            <Pill color={STATUS_COLOR[row.status]}>{label(row.status)}</Pill>
          </div>
          <p className="text-[12.5px] text-slate-600 mt-1 line-clamp-2">{row.summary}</p>
          <p className="text-[11px] text-slate-400 mt-1">{fmt(row.createdAt)}</p>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
            <DetailPanel>
              {/* Summary */}
              <p className="text-[13px] font-semibold text-slate-800 mb-3">{row.summary}</p>

              {/* Meta grid */}
              <MetaGrid
                items={[
                  { label: 'Detector', value: label(row.detectorId) },
                  { label: 'Severity', value: row.severity },
                  { label: 'Status', value: label(row.status) },
                  { label: 'Detected', value: fmt(row.createdAt) },
                  { label: 'Window', value: `${fmt(row.windowStart)} → ${fmt(row.windowEnd)}` },
                  { label: 'Practice', value: row.practiceContext ?? '—' },
                ]}
              />

              {/* Evidence */}
              <Section title="Evidence">
                <EvidenceGrid evidence={row.evidence} />
              </Section>

              {/* Actions or disposition */}
              {terminal ? (
                <div className="mt-4 rounded-xl bg-white border border-slate-200 px-4 py-3 text-[12.5px] text-slate-600">
                  Dispositioned as <strong>{label(row.status)}</strong>
                  {row.escalatedToIncidentId ? ' — tracked in the Incidents tab.' : row.benignReason ? ` — "${row.benignReason}"` : '.'}
                </div>
              ) : (
                <Section title="Take action">
                  <div className="flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap gap-2">
                      <ActionBtn primary testId="worklist-acknowledge" onClick={onAcknowledge}>Acknowledge</ActionBtn>
                    </div>
                    <Field label="Mark benign — reason required">
                      <textarea data-testid="worklist-benign-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this not a real problem?" rows={2} className="w-full text-[12px] rounded-lg border border-slate-200 px-3 py-2 outline-none resize-none focus:border-[#7B00E0]" />
                      <ActionBtn testId="worklist-benign" disabled={reason.trim().length < 3} onClick={() => onBenign(reason.trim())}>Mark benign</ActionBtn>
                    </Field>
                    <Field label="Escalate — opens a security incident">
                      <textarea data-testid="worklist-escalate-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes to seed the incident" rows={2} className="w-full text-[12px] rounded-lg border border-slate-200 px-3 py-2 outline-none resize-none focus:border-[#7B00E0]" />
                      <ActionBtn danger testId="worklist-escalate" onClick={() => onEscalate(notes.trim())}>Escalate → open incident</ActionBtn>
                    </Field>
                  </div>
                </Section>
              )}
            </DetailPanel>
        </div>
      )}
    </div>
  );
}

// ─── Incident card (+ organized detail panel) ────────────────────────────────

function IncidentCard({
  row,
  expanded,
  onToggle,
  onAssign,
  onNote,
  onResolve,
}: {
  row: IncidentRow;
  expanded: boolean;
  onToggle: () => void;
  onAssign: () => void;
  onNote: (note: string) => void;
  onResolve: (notes: string) => void;
}) {
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('');

  useEffect(() => {
    if (!expanded) return;
    let live = true;
    void getIncident(row.id)
      .then((d) => { if (live) setDetail(d); })
      .catch(() => { if (live) setDetail(null); });
    return () => { live = false; };
  }, [expanded, row.id]);

  const resolved = row.status === 'RESOLVED';

  return (
    <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden" data-testid="worklist-incident-row">
      <button type="button" onClick={onToggle} className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-slate-50/60 transition">
        <span className="text-slate-400 mt-0.5 shrink-0">{expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="text-[13px] font-semibold text-slate-700 break-words">{row.title}</span>
            <Pill color={SEVERITY_COLOR[row.severity]}>{row.severity}</Pill>
            <Pill color={STATUS_COLOR[row.status]}>{label(row.status)}</Pill>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Opened {fmt(row.createdAt)}
            {row.sourceDetectorId ? ` · ${label(row.sourceDetectorId)}` : ''}
          </p>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
            <DetailPanel>
              <p className="text-[13px] font-semibold text-slate-800 mb-3 whitespace-pre-wrap">{row.summary}</p>

              <MetaGrid
                items={[
                  { label: 'Severity', value: row.severity },
                  { label: 'Status', value: label(row.status) },
                  { label: 'Opened', value: fmt(row.createdAt) },
                  { label: 'Opened by', value: row.openedByOpsId },
                  { label: 'Assigned to', value: row.assignedToOpsId ?? 'Unassigned' },
                  { label: 'Source detector', value: row.sourceDetectorId ? label(row.sourceDetectorId) : '—' },
                  { label: 'Practice', value: row.practiceContext ?? '—' },
                  ...(row.resolvedAt ? [{ label: 'Resolved', value: fmt(row.resolvedAt) }] : []),
                ]}
              />

              {!resolved && (
                <Section title="Take action">
                  <div className="flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap gap-2">
                      <ActionBtn testId="worklist-assign" onClick={onAssign}>Assign to me</ActionBtn>
                    </div>
                    <Field label="Add a note">
                      <textarea data-testid="worklist-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Investigation note…" rows={2} className="w-full text-[12px] rounded-lg border border-slate-200 px-3 py-2 outline-none resize-none focus:border-[#7B00E0]" />
                      <ActionBtn testId="worklist-note-add" disabled={note.trim().length < 1} onClick={() => onNote(note.trim())}>Add note</ActionBtn>
                    </Field>
                    <Field label="Resolve — resolution notes required">
                      <textarea data-testid="worklist-resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="How was it resolved?" rows={2} className="w-full text-[12px] rounded-lg border border-slate-200 px-3 py-2 outline-none resize-none focus:border-[#7B00E0]" />
                      <ActionBtn primary testId="worklist-resolve" disabled={resolution.trim().length < 3} onClick={() => onResolve(resolution.trim())}>Resolve incident</ActionBtn>
                    </Field>
                  </div>
                </Section>
              )}

              {resolved && row.resolutionNotes && (
                <Section title="Resolution">
                  <p className="text-[12.5px] text-slate-600">{row.resolutionNotes}</p>
                </Section>
              )}

              <Section title="Timeline">
                {detail === null ? (
                  <p className="text-[12px] text-slate-400">Loading…</p>
                ) : detail.actions.length === 0 ? (
                  <p className="text-[12px] text-slate-400">No actions yet.</p>
                ) : (
                  <ol className="relative border-l border-slate-200 ml-1.5 flex flex-col gap-3" data-testid="worklist-timeline">
                    {detail.actions.map((a) => (
                      <li key={a.id} className="ml-4">
                        <span className="absolute -left-[5px] mt-1 w-2.5 h-2.5 rounded-full bg-[#7B00E0]" />
                        <p className="text-[12.5px] font-semibold text-slate-700">{label(a.actionType)}</p>
                        <p className="text-[11px] text-slate-400">{fmt(a.performedAt)}</p>
                        {a.metadata && (a.metadata.note || a.metadata.resolutionNotes) ? (
                          <p className="text-[12px] text-slate-600 mt-0.5">{String(a.metadata.note ?? a.metadata.resolutionNotes)}</p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </Section>
            </DetailPanel>
        </div>
      )}
    </div>
  );
}

// ─── Detail-panel building blocks ────────────────────────────────────────────

function DetailPanel({ children }: { children: ReactNode }) {
  return <div className="rounded-xl bg-white border border-slate-200 p-5">{children}</div>;
}

function MetaGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
      {items.map((it) => (
        <div key={it.label}>
          <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{it.label}</dt>
          <dd className="text-[12.5px] text-slate-700 mt-0.5 break-words">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EvidenceGrid({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence ?? {});
  if (entries.length === 0) return <p className="text-[12px] text-slate-400">No structured evidence.</p>;
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3" data-testid="worklist-evidence">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{humanizeKey(k)}</dt>
          <dd className="text-[12.5px] font-semibold text-slate-700 mt-0.5 break-words tabular-nums">{renderValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5 pt-4 border-t border-slate-100">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">{title}</p>
      {children}
    </div>
  );
}

function Field({ label: fieldLabel, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 max-w-xl">
      <span className="text-[11.5px] font-semibold text-slate-500">{fieldLabel}</span>
      {children}
    </div>
  );
}

// ─── Small presentational helpers ────────────────────────────────────────────

function Pill({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wide" style={{ color, backgroundColor: `${color}1A` }}>
      {children}
    </span>
  );
}

function ActionBtn({ children, onClick, disabled, primary, danger, testId }: { children: ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; danger?: boolean; testId?: string }) {
  const base = 'h-9 px-4 rounded-full text-[12.5px] font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed self-start';
  const style = danger
    ? 'bg-[#DC2626] text-white hover:bg-[#B91C1C]'
    : primary
    ? 'bg-[#7B00E0] text-white hover:bg-[#6600BC]'
    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50';
  return (
    <button type="button" data-testid={testId} onClick={onClick} disabled={disabled} className={`${base} ${style}`}>{children}</button>
  );
}

function TabButton({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: ReactNode; testId: string }) {
  return (
    <button type="button" data-testid={testId} onClick={onClick} className={`h-9 px-4 rounded-full text-[13px] font-semibold transition border ${active ? 'bg-[#7B00E0] text-white border-[#7B00E0]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{children}</button>
  );
}

function FilterGroup({ label: groupLabel, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wider px-1" style={{ color: 'var(--brand-text-muted)' }}>{groupLabel}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Select({ value, options, onChange, placeholder, testId }: { value: string; options: string[]; onChange: (v: string) => void; placeholder: string; testId: string }) {
  return (
    <select data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 px-3 rounded-full bg-white border border-slate-200 text-[12px] text-slate-600 outline-none">
      {options.map((o) => (
        <option key={o} value={o}>{o === '' ? placeholder : label(o)}</option>
      ))}
    </select>
  );
}

function Banner({ tone, children, testId }: { tone: 'ok' | 'err'; children: ReactNode; testId: string }) {
  const style = tone === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200';
  return <div data-testid={testId} className={`text-[12.5px] rounded-xl border px-3 py-2 mb-3 ${style}`}>{children}</div>;
}

function ListMessage({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 px-4 py-10 text-center text-[12.5px] text-slate-400" data-testid={testId}>
      {children}
    </div>
  );
}

function PagerButton({ children, onClick, disabled, ariaLabel }: { children: ReactNode; onClick: () => void; disabled: boolean; ariaLabel: string }) {
  return (
    <button type="button" aria-label={ariaLabel} onClick={onClick} disabled={disabled} className="w-8 h-8 rounded-lg flex items-center justify-center border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">{children}</button>
  );
}
