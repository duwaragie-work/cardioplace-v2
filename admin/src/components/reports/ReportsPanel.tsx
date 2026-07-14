'use client';

// Phase/24 — Monthly Practice Analytics Report page panel.
//
// Header on top (icon + title + cached/fresh badge), then the filter card
// (month picker + practice dropdown for OPS/SUPER + Recompute + CSV/PDF
// downloads), then KPI tiles, By Tier table, By Provider table. Stacks on
// mobile; one-line filter row at lg+ — same responsive language as the
// user-management panel (max-w-1200, rounded-2xl cards, brand-shadow).

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  defaultPreviousMonth,
  downloadMonthlyReportCsv,
  downloadMonthlyReportPdf,
  formatMonthLabel,
  getMonthlyReport,
  listReportPractices,
  type MonthlyReport,
  type ReportPractice,
} from '@/lib/services/reports.service';
import { useAuth } from '@/lib/auth-context';
import ReportByProviderTable from './ReportByProviderTable';
import ReportByTierTable from './ReportByTierTable';
import ReportSummaryTiles from './ReportSummaryTiles';

export default function ReportsPanel() {
  const { user, isLoading: authLoading } = useAuth();

  // ─── Picker state ────────────────────────────────────────────────────────
  const [practices, setPractices] = useState<ReportPractice[]>([]);
  const [practiceId, setPracticeId] = useState<string>('');
  const [month, setMonth] = useState<string>(defaultPreviousMonth());
  const [picksLoaded, setPicksLoaded] = useState(false);

  // ─── Server state ────────────────────────────────────────────────────────
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [recomputing, setRecomputing] = useState(false);

  // Load the accessible-practices list once on mount. MED_DIR usually has
  // exactly one row; OPS / SUPER may have many.
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    listReportPractices()
      .then((list) => {
        if (cancelled) return;
        setPractices(list);
        if (list.length > 0 && !practiceId) {
          setPracticeId(list[0].id);
        }
        setPicksLoaded(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(
          e instanceof Error ? e.message : 'Could not load practices.',
        );
        setPicksLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, practiceId]);

  const fetchReport = useCallback(
    async (fresh: boolean) => {
      if (!practiceId) return;
      if (fresh) setRecomputing(true);
      else setLoading(true);
      setLoadError(null);
      try {
        const data = await getMonthlyReport({ practiceId, month, fresh });
        setReport(data);
        if (fresh) toast.success('Report recomputed from raw data');
      } catch (e) {
        setReport(null);
        setLoadError(
          e instanceof Error ? e.message : 'Could not load report.',
        );
      } finally {
        setLoading(false);
        setRecomputing(false);
      }
    },
    [practiceId, month],
  );

  // Refetch whenever the picked practice or month changes.
  useEffect(() => {
    if (!practiceId) return;
    void fetchReport(false);
  }, [practiceId, month, fetchReport]);

  const selectedPractice = useMemo(
    () => practices.find((p) => p.id === practiceId) ?? null,
    [practices, practiceId],
  );

  async function handleDownloadCsv() {
    if (!practiceId) return;
    setDownloadingCsv(true);
    try {
      await downloadMonthlyReportCsv({ practiceId, month });
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
      await downloadMonthlyReportPdf({ practiceId, month });
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
    : `Monthly KPIs · ${formatMonthLabel(month)}`;

  return (
    <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-6 space-y-5">
      {/* Header — title left, downloads right on lg+ */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
            style={{
              background: 'linear-gradient(135deg, #7B00E0, #9333EA)',
            }}
            aria-hidden
          >
            <CalendarDays className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1
              className="text-xl font-bold truncate"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              Monthly practice report
            </h1>
            <p
              className="text-[12px] truncate"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              {subtitle}
            </p>
            {report && (
              <CacheBadge
                cached={report.cached}
                generatedAt={report.generatedAt}
              />
            )}
          </div>
        </div>

        {/* Primary CTAs */}
        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:shrink-0 lg:justify-end">
          <button
            type="button"
            onClick={() => fetchReport(true)}
            disabled={!practiceId || recomputing || loading}
            data-testid="report-recompute"
            className="btn-admin-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw
              className={
                'w-3.5 h-3.5 mr-1.5 ' + (recomputing ? 'animate-spin' : '')
              }
            />
            {recomputing ? 'Recomputing…' : 'Recompute'}
          </button>
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={!report || downloadingCsv}
            data-testid="report-download-csv"
            className="btn-admin-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            {downloadingCsv ? 'Downloading…' : 'CSV'}
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={!report || downloadingPdf}
            data-testid="report-download-pdf"
            className="btn-admin-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileText className="w-3.5 h-3.5 mr-1.5" />
            {downloadingPdf ? 'Downloading…' : 'PDF'}
          </button>
        </div>
      </div>

      {/* Filter card — both cells share one row at every breakpoint via
          flex-wrap. Each cell stacks label above control on mobile, then
          goes inline at sm+ to save vertical space. Mirrors the
          user-management FilterSelect responsive language. */}
      <div
        className="bg-white rounded-2xl p-3 sm:p-4"
        style={{ boxShadow: 'var(--brand-shadow-card)' }}
      >
        <div className="flex flex-row flex-wrap items-end gap-x-3 gap-y-2">
          {/* Month picker */}
          <div className="flex flex-col gap-1 min-w-0 flex-1 basis-[140px] sm:flex-row sm:items-center sm:gap-2 sm:basis-auto sm:flex-none">
            <label
              htmlFor="report-month"
              className="shrink-0 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              Month
            </label>
            <input
              id="report-month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              max={defaultPreviousMonth(
                new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
              )}
              data-testid="report-month-picker"
              className="appearance-none h-9 pl-3 pr-2 rounded-full text-[12px] font-semibold outline-none cursor-pointer w-full sm:w-[180px]"
              style={{
                backgroundColor: 'white',
                color: 'var(--brand-text-primary)',
                border: '1.5px solid var(--brand-border)',
              }}
            />
          </div>

          {/* Practice picker — only when caller has more than one */}
          {showPracticePicker && (
            <div className="flex flex-col gap-1 min-w-0 flex-1 basis-[140px] sm:flex-row sm:items-center sm:gap-2 sm:basis-auto sm:flex-none">
              <label
                htmlFor="report-practice"
                className="shrink-0 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                Practice
              </label>
              <div className="relative w-full sm:w-auto">
                <select
                  id="report-practice"
                  value={practiceId}
                  onChange={(e) => setPracticeId(e.target.value)}
                  data-testid="report-practice-picker"
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

          {/* Single-practice MD: surface the practice name read-only */}
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
                data-testid="report-practice-locked"
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
          style={{
            color: 'var(--brand-alert-red)',
            backgroundColor: 'var(--brand-alert-red-light)',
          }}
          data-testid="report-error"
        >
          {loadError}
        </p>
      )}

      {!picksLoaded && (
        <PanelSkeleton />
      )}

      {picksLoaded && practices.length === 0 && !loadError && (
        <EmptyAccess />
      )}

      {picksLoaded && practices.length > 0 && loading && !report && (
        <PanelSkeleton />
      )}

      {picksLoaded && report && (
        <div className="relative space-y-5">
          <ReportSummaryTiles overall={report.overall} />
          <ReportByTierTable rows={report.byTier} />
          <ReportByProviderTable rows={report.byProvider} />
          <FooterMeta report={report} />

          {/* Refetch overlay — appears whenever a filter change (loading)
              or an explicit "Recompute" (recomputing) is in flight AND
              we already have a report on screen. Stays out of the way
              of the first load (which uses PanelSkeleton above) and
              lets the stale data peek through dimmed so the reader
              keeps their place. */}
          {(loading || recomputing) && (
            <div
              className="absolute inset-0 flex items-start justify-center pt-12 rounded-2xl pointer-events-none"
              style={{ backgroundColor: 'rgba(255, 255, 255, 0.55)' }}
              data-testid="report-refetch-overlay"
              aria-live="polite"
              aria-busy="true"
            >
              <div
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white"
                style={{
                  boxShadow: 'var(--brand-shadow-card)',
                  color: 'var(--brand-primary-purple)',
                }}
              >
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                <span className="text-[12px] font-semibold">
                  {recomputing ? 'Recomputing report…' : 'Updating…'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-bits ───────────────────────────────────────────────────────────────

function CacheBadge({
  cached,
  generatedAt,
}: {
  cached: boolean;
  generatedAt: string;
}) {
  const when = (() => {
    try {
      return new Date(generatedAt).toLocaleString();
    } catch {
      return generatedAt;
    }
  })();
  return (
    <p
      className="text-[10px] mt-1"
      style={{ color: 'var(--brand-text-muted)' }}
      data-testid="report-cache-badge"
    >
      {cached ? 'Cached snapshot' : 'Fresh compute'} · {when}
    </p>
  );
}

function FooterMeta({ report }: { report: MonthlyReport }) {
  const patients = report.overall.totalPatients;
  return (
    <p
      className="text-[11px] text-center"
      style={{ color: 'var(--brand-text-muted)' }}
    >
      Window {report.windowStart} → {report.windowEnd} ({report.practiceTimezone})
      {' · '}
      {patients} {patients === 1 ? 'patient' : 'patients'} in practice
    </p>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3" data-testid="report-skeleton">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="p-4 rounded-2xl bg-white animate-pulse"
            style={{ boxShadow: 'var(--brand-shadow-card)' }}
          >
            <div
              className="h-2 rounded mb-3"
              style={{ width: '40%', backgroundColor: 'var(--brand-border)' }}
            />
            <div
              className="h-6 rounded"
              style={{ width: '60%', backgroundColor: 'var(--brand-border)' }}
            />
          </div>
        ))}
      </div>
      {[1, 2].map((i) => (
        <div
          key={i}
          className="p-6 rounded-2xl bg-white animate-pulse"
          style={{ boxShadow: 'var(--brand-shadow-card)' }}
        >
          <div
            className="h-2 rounded mb-4"
            style={{ width: '20%', backgroundColor: 'var(--brand-border)' }}
          />
          {[1, 2, 3, 4].map((j) => (
            <div
              key={j}
              className="h-3 rounded mb-2"
              style={{
                width: `${60 + j * 5}%`,
                backgroundColor: 'var(--brand-border)',
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyAccess() {
  return (
    <div
      className="bg-white rounded-2xl p-8 text-center"
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
      data-testid="report-no-practices"
    >
      <p
        className="text-sm font-semibold"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        You don&apos;t have access to any practice reports yet.
      </p>
    </div>
  );
}
