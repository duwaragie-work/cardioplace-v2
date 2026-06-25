'use client';

// Task 3 — Alert-Resolution-Time SLA panel.
//
// Month + practice pickers, two headline tiles, and a per-tier scorecard
// (Ack + Resolve: target vs mean, with a PASS/FAIL verdict). Desktop table
// collapses to cards below lg, like the other report tables.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Download, FileText, Gauge, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  defaultPreviousMonth,
  downloadSlaCsv,
  downloadSlaPdf,
  formatDuration,
  formatMonthLabel,
  formatTierLabel,
  getSlaReport,
  isSlaExemptTier,
  listReportPractices,
  SLA_NOT_APPLICABLE_LABEL,
  type ReportPractice,
  type SlaReport,
} from '@/lib/services/sla.service';
import { useAuth } from '@/lib/auth-context';

type Verdict = boolean | null;

export default function SlaPanel() {
  const { user, isLoading: authLoading } = useAuth();

  const [practices, setPractices] = useState<ReportPractice[]>([]);
  const [practiceId, setPracticeId] = useState<string>('');
  const [month, setMonth] = useState<string>(defaultPreviousMonth());
  const [picksLoaded, setPicksLoaded] = useState(false);

  const [report, setReport] = useState<SlaReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    listReportPractices()
      .then((list) => {
        if (cancelled) return;
        setPractices(list);
        if (list.length > 0 && !practiceId) setPracticeId(list[0].id);
        setPicksLoaded(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : 'Could not load practices.');
        setPicksLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, practiceId]);

  const fetchReport = useCallback(async () => {
    if (!practiceId) return;
    setLoading(true);
    setLoadError(null);
    try {
      setReport(await getSlaReport({ practiceId, month }));
    } catch (e) {
      setReport(null);
      setLoadError(e instanceof Error ? e.message : 'Could not load report.');
    } finally {
      setLoading(false);
    }
  }, [practiceId, month]);

  useEffect(() => {
    if (!practiceId) return;
    void fetchReport();
  }, [practiceId, month, fetchReport]);

  const selectedPractice = useMemo(
    () => practices.find((p) => p.id === practiceId) ?? null,
    [practices, practiceId],
  );

  async function handleDownloadCsv() {
    if (!practiceId) return;
    setDownloadingCsv(true);
    try {
      await downloadSlaCsv({ practiceId, month });
      toast.success('CSV downloaded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'CSV download failed');
    } finally {
      setDownloadingCsv(false);
    }
  }

  async function handleDownloadPdf() {
    if (!practiceId) return;
    setDownloadingPdf(true);
    try {
      await downloadSlaPdf({ practiceId, month });
      toast.success('PDF downloaded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'PDF download failed');
    } finally {
      setDownloadingPdf(false);
    }
  }

  const showPracticePicker = practices.length > 1;
  const subtitle = selectedPractice?.name
    ? `${selectedPractice.name} · ${formatMonthLabel(month)}`
    : `Response-time SLAs · ${formatMonthLabel(month)}`;

  return (
    <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
            style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
            aria-hidden
          >
            <Gauge className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>
              Alert SLAs
            </h1>
            <p className="text-[12px] truncate" style={{ color: 'var(--brand-text-muted)' }}>
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:shrink-0 lg:justify-end">
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={!report || downloadingCsv}
            data-testid="sla-download-csv"
            className="btn-admin-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            {downloadingCsv ? 'Downloading…' : 'CSV'}
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={!report || downloadingPdf}
            data-testid="sla-download-pdf"
            className="btn-admin-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileText className="w-3.5 h-3.5 mr-1.5" />
            {downloadingPdf ? 'Downloading…' : 'PDF'}
          </button>
        </div>
      </div>

      {/* Filter card */}
      <div className="bg-white rounded-2xl p-3 sm:p-4" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        <div className="flex flex-row flex-wrap items-end gap-x-3 gap-y-2">
          <div className="flex flex-col gap-1 min-w-0 flex-1 basis-[140px] sm:flex-row sm:items-center sm:gap-2 sm:basis-auto sm:flex-none">
            <label
              htmlFor="sla-month"
              className="shrink-0 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              Month
            </label>
            <input
              id="sla-month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              max={defaultPreviousMonth(
                new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
              )}
              data-testid="sla-month-picker"
              className="appearance-none h-9 pl-3 pr-2 rounded-full text-[12px] font-semibold outline-none cursor-pointer w-full sm:w-[180px]"
              style={{
                backgroundColor: 'white',
                color: 'var(--brand-text-primary)',
                border: '1.5px solid var(--brand-border)',
              }}
            />
          </div>

          {showPracticePicker && (
            <div className="flex flex-col gap-1 min-w-0 flex-1 basis-[140px] sm:flex-row sm:items-center sm:gap-2 sm:basis-auto sm:flex-none">
              <label
                htmlFor="sla-practice"
                className="shrink-0 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                Practice
              </label>
              <div className="relative w-full sm:w-auto">
                <select
                  id="sla-practice"
                  value={practiceId}
                  onChange={(e) => setPracticeId(e.target.value)}
                  data-testid="sla-practice-picker"
                  className="appearance-none h-9 pl-3 pr-8 rounded-full text-[12px] font-semibold outline-none cursor-pointer w-full sm:w-[240px]"
                  style={{
                    backgroundColor: 'white',
                    color: 'var(--brand-text-primary)',
                    border: '1.5px solid var(--brand-border)',
                  }}
                >
                  {practices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                  style={{ color: 'var(--brand-text-muted)' }}
                />
              </div>
            </div>
          )}

          {!showPracticePicker && selectedPractice && (
            <div className="flex flex-col gap-1 min-w-0 sm:flex-row sm:items-center sm:gap-2">
              <span
                className="shrink-0 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                Practice
              </span>
              <span
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[12px] font-semibold truncate max-w-[260px]"
                style={{
                  backgroundColor: 'var(--brand-primary-purple-light)',
                  color: 'var(--brand-primary-purple)',
                }}
                data-testid="sla-practice-locked"
              >
                {selectedPractice.name}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      {loadError && (
        <p
          className="text-sm font-semibold px-3 py-2 rounded-lg"
          role="alert"
          style={{ color: 'var(--brand-alert-red)', backgroundColor: 'var(--brand-alert-red-light)' }}
          data-testid="sla-error"
        >
          {loadError}
        </p>
      )}

      {!picksLoaded && <PanelSkeleton />}
      {picksLoaded && practices.length === 0 && !loadError && <EmptyAccess />}
      {picksLoaded && practices.length > 0 && loading && !report && <PanelSkeleton />}

      {picksLoaded && report && (
        <div className="relative space-y-5">
          <Tiles report={report} />
          <SlaTable report={report} />
          <FooterMeta report={report} />

          {loading && (
            <div
              className="absolute inset-0 flex items-start justify-center pt-12 rounded-2xl pointer-events-none"
              style={{ backgroundColor: 'rgba(255, 255, 255, 0.55)' }}
              aria-live="polite"
              aria-busy="true"
            >
              <div
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white"
                style={{ boxShadow: 'var(--brand-shadow-card)', color: 'var(--brand-primary-purple)' }}
              >
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                <span className="text-[12px] font-semibold">Updating…</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Tiles({ report }: { report: SlaReport }) {
  const tiles = [
    {
      label: 'Acked within target',
      value: report.overallAckWithinPct === null ? '—' : `${report.overallAckWithinPct}%`,
      caption: 'across SLA-tracked tiers',
    },
    {
      label: 'Tiers failing',
      value: String(report.tiersFailing),
      caption: 'average over target',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="p-4 rounded-2xl bg-white" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--brand-primary-purple)' }}>
            {t.label}
          </p>
          <p className="text-2xl font-bold" style={{ color: 'var(--brand-text-primary)' }}>
            {t.value}
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
            {t.caption}
          </p>
        </div>
      ))}
    </div>
  );
}

function VerdictBadge({ pass }: { pass: Verdict }) {
  const s =
    pass === null
      ? { label: 'No data', bg: '#F1F5F9', fg: 'var(--brand-text-muted)' }
      : pass
        ? { label: 'Pass', bg: '#DCFCE7', fg: '#15803D' }
        : { label: 'Fail', bg: 'var(--brand-alert-red-light)', fg: 'var(--brand-alert-red)' };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

function SlaTable({ report }: { report: SlaReport }) {
  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
      {/* Desktop table — lg+ */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-left border-collapse" data-testid="sla-table">
          <thead>
            <tr style={{ backgroundColor: '#F8FAFC' }}>
              <Th>Tier</Th>
              <Th align="right">Alerts</Th>
              <Th align="right">Ack target</Th>
              <Th align="right">Mean ack</Th>
              <Th align="center">Ack</Th>
              <Th align="right">Resolve target</Th>
              <Th align="right">Mean resolve</Th>
              <Th align="center">Resolve</Th>
            </tr>
          </thead>
          <tbody>
            {report.byTier.map((r, i) => (
              <tr key={r.tier} style={{ backgroundColor: i % 2 === 1 ? '#FAFBFF' : 'white' }}>
                <Td>
                  <span className="font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                    {formatTierLabel(r.tier)}
                  </span>
                </Td>
                <Td align="right">{r.total}</Td>
                {isSlaExemptTier(r.tier) ? (
                  <td
                    colSpan={6}
                    className="px-3 py-3 text-[13px] text-center font-semibold"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    {SLA_NOT_APPLICABLE_LABEL}
                  </td>
                ) : (
                  <>
                    <Td align="right">{formatDuration(r.ackTargetSeconds)}</Td>
                    <Td align="right">{formatDuration(r.meanAckSeconds)}</Td>
                    <Td align="center"><VerdictBadge pass={r.ackPass} /></Td>
                    <Td align="right">{formatDuration(r.resolveTargetSeconds)}</Td>
                    <Td align="right">{formatDuration(r.meanResolveSeconds)}</Td>
                    <Td align="center"><VerdictBadge pass={r.resolvePass} /></Td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile / tablet cards — below lg */}
      <div className="lg:hidden">
        {report.byTier.map((r, i) => (
          <div
            key={r.tier}
            className="px-4 py-4"
            style={{ borderTop: i > 0 ? '1px solid var(--brand-border)' : undefined }}
          >
            <div className="flex items-center justify-between gap-3 mb-3 min-w-0">
              <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                {formatTierLabel(r.tier)}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
                {r.total} alert{r.total === 1 ? '' : 's'}
              </span>
            </div>
            {isSlaExemptTier(r.tier) ? (
              <div
                className="px-3 py-3 rounded-lg text-[12px] font-semibold text-center"
                style={{ backgroundColor: 'var(--brand-background)', color: 'var(--brand-text-muted)' }}
              >
                {SLA_NOT_APPLICABLE_LABEL}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Milestone
                  label="Acknowledge"
                  target={formatDuration(r.ackTargetSeconds)}
                  mean={formatDuration(r.meanAckSeconds)}
                  pass={r.ackPass}
                />
                <Milestone
                  label="Resolve"
                  target={formatDuration(r.resolveTargetSeconds)}
                  mean={formatDuration(r.meanResolveSeconds)}
                  pass={r.resolvePass}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        className="px-4 py-3 border-t text-[11px] leading-relaxed"
        style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-muted)' }}
      >
        <span className="font-semibold">Pass</span> = the average time is at or below the target.{' '}
        <span className="font-semibold">Target</span> times are provisional, pending sign-off.
      </div>
    </div>
  );
}

function Milestone({
  label,
  target,
  mean,
  pass,
}: {
  label: string;
  target: string;
  mean: string;
  pass: Verdict;
}) {
  return (
    <div className="px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--brand-background)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--brand-text-muted)' }}>
          {label}
        </span>
        <VerdictBadge pass={pass} />
      </div>
      <p className="text-[12px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
        {mean}
      </p>
      <p className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>
        target {target}
      </p>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' | 'center' }) {
  const a = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      className={'px-3 py-3 text-[10px] font-bold uppercase tracking-wider ' + a}
      style={{ color: 'var(--brand-text-muted)' }}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'right' | 'center' }) {
  const a = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <td className={'px-3 py-3 text-[13px] ' + a} style={{ color: 'var(--brand-text-secondary)' }}>
      {children}
    </td>
  );
}

function FooterMeta({ report }: { report: SlaReport }) {
  const fmt = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString();
    } catch {
      return iso;
    }
  };
  return (
    <p className="text-[11px] text-center" style={{ color: 'var(--brand-text-muted)' }}>
      {report.monthYear} · {fmt(report.windowStart)} → {fmt(report.windowEnd)} ({report.practiceTimezone})
    </p>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3" data-testid="sla-skeleton">
      <div className="grid grid-cols-2 gap-3">
        {[1, 2].map((i) => (
          <div key={i} className="p-4 rounded-2xl bg-white animate-pulse" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
            <div className="h-2 rounded mb-3" style={{ width: '40%', backgroundColor: 'var(--brand-border)' }} />
            <div className="h-6 rounded" style={{ width: '60%', backgroundColor: 'var(--brand-border)' }} />
          </div>
        ))}
      </div>
      <div className="p-6 rounded-2xl bg-white animate-pulse" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        {[1, 2, 3, 4].map((j) => (
          <div key={j} className="h-3 rounded mb-2" style={{ width: `${60 + j * 5}%`, backgroundColor: 'var(--brand-border)' }} />
        ))}
      </div>
    </div>
  );
}

function EmptyAccess() {
  return (
    <div className="bg-white rounded-2xl p-8 text-center" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
      <p className="text-sm font-semibold" style={{ color: 'var(--brand-text-muted)' }}>
        You don&apos;t have access to any practice reports yet.
      </p>
    </div>
  );
}
