'use client';

// Task 4 — Per-Condition Cohort panel.
//
// Month + practice pickers, then a comparison table: one row per cohort
// (All patients baseline first, then HFrEF / CAD / Pregnancy) with patient
// count, BP-control rate, alerts, and an unverified-profile count. Table
// collapses to cards below lg.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Download, FileText, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  defaultPreviousMonth,
  downloadCohortCsv,
  downloadCohortPdf,
  formatMonthLabel,
  formatPct,
  getCohortReport,
  listReportPractices,
  type CohortReport,
  type ReportPractice,
} from '@/lib/services/cohort.service';
import { useAuth } from '@/lib/auth-context';

export default function CohortPanel() {
  const { user, isLoading: authLoading } = useAuth();

  const [practices, setPractices] = useState<ReportPractice[]>([]);
  const [practiceId, setPracticeId] = useState<string>('');
  const [month, setMonth] = useState<string>(defaultPreviousMonth());
  const [picksLoaded, setPicksLoaded] = useState(false);

  const [report, setReport] = useState<CohortReport | null>(null);
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
      setReport(await getCohortReport({ practiceId, month }));
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
      await downloadCohortCsv({ practiceId, month });
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
      await downloadCohortPdf({ practiceId, month });
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
    : `Outcomes by condition · ${formatMonthLabel(month)}`;

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
            <Users className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>
              Condition cohorts
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
            data-testid="cohort-download-csv"
            className="btn-admin-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            {downloadingCsv ? 'Downloading…' : 'CSV'}
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={!report || downloadingPdf}
            data-testid="cohort-download-pdf"
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
              htmlFor="cohort-month"
              className="shrink-0 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              Month
            </label>
            <input
              id="cohort-month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              max={defaultPreviousMonth(
                new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
              )}
              data-testid="cohort-month-picker"
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
                htmlFor="cohort-practice"
                className="shrink-0 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                Practice
              </label>
              <div className="relative w-full sm:w-auto">
                <select
                  id="cohort-practice"
                  value={practiceId}
                  onChange={(e) => setPracticeId(e.target.value)}
                  data-testid="cohort-practice-picker"
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
                data-testid="cohort-practice-locked"
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
          data-testid="cohort-error"
        >
          {loadError}
        </p>
      )}

      {!picksLoaded && <PanelSkeleton />}
      {picksLoaded && practices.length === 0 && !loadError && <EmptyAccess />}
      {picksLoaded && practices.length > 0 && loading && !report && <PanelSkeleton />}

      {picksLoaded && report && (
        <div className="relative space-y-5">
          <CohortTable report={report} />
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

function CohortTable({ report }: { report: CohortReport }) {
  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
      {/* Desktop table — lg+ */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-left border-collapse" data-testid="cohort-table">
          <thead>
            <tr style={{ backgroundColor: '#F8FAFC' }}>
              <Th>Cohort</Th>
              <Th align="right">Patients</Th>
              <Th align="right">With readings</Th>
              <Th align="right">BP control</Th>
              <Th align="right">Alerts</Th>
              <Th align="right">Unverified</Th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r, i) => {
              const baseline = r.cohort === 'ALL';
              return (
                <tr
                  key={r.cohort}
                  style={{
                    backgroundColor: baseline
                      ? 'var(--brand-primary-purple-light)'
                      : i % 2 === 1
                        ? '#FAFBFF'
                        : 'white',
                  }}
                >
                  <Td>
                    <span
                      className={baseline ? 'font-bold' : 'font-semibold'}
                      style={{ color: 'var(--brand-text-primary)' }}
                    >
                      {r.label}
                    </span>
                  </Td>
                  <Td align="right">{r.patientCount}</Td>
                  <Td align="right">{r.patientsWithReadings}</Td>
                  <Td align="right">
                    <span className="font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                      {formatPct(r.controlRatePct)}
                    </span>
                  </Td>
                  <Td align="right">{r.alertCount}</Td>
                  <Td align="right">
                    {r.unverifiedProfiles > 0 ? (
                      <span style={{ color: 'var(--brand-alert-amber, #B45309)' }}>
                        {r.unverifiedProfiles}
                      </span>
                    ) : (
                      0
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile / tablet cards — below lg */}
      <div className="lg:hidden">
        {report.rows.map((r, i) => {
          const baseline = r.cohort === 'ALL';
          return (
            <div
              key={r.cohort}
              className="px-4 py-4"
              style={{
                borderTop: i > 0 ? '1px solid var(--brand-border)' : undefined,
                backgroundColor: baseline ? 'var(--brand-primary-purple-light)' : undefined,
              }}
            >
              <div className="flex items-center justify-between gap-3 mb-3 min-w-0">
                <span
                  className={(baseline ? 'font-bold' : 'font-semibold') + ' text-[13px] truncate'}
                  style={{ color: 'var(--brand-text-primary)' }}
                >
                  {r.label}
                </span>
                <span className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
                  {r.patientCount} patient{r.patientCount === 1 ? '' : 's'}
                </span>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-[11px]">
                <Stat label="BP control" value={formatPct(r.controlRatePct)} />
                <Stat label="Alerts" value={String(r.alertCount)} />
                <Stat label="Unverified" value={String(r.unverifiedProfiles)} />
              </dl>
            </div>
          );
        })}
      </div>

      <div
        className="px-4 py-3 border-t text-[11px] leading-relaxed"
        style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-muted)' }}
      >
        <span className="font-semibold">Cohorts overlap</span> — a patient with more than
        one condition is counted in each, so cohort patient counts can add up to more than
        the total. <span className="font-semibold">Unverified</span> = profiles whose condition
        flag isn&apos;t confirmed yet. <span className="font-semibold">BP control</span> uses the{' '}
        {report.defaultSbpUpper}/{report.defaultDbpUpper} default target (provisional).
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      className={'px-4 py-3 text-[10px] font-bold uppercase tracking-wider ' + (align === 'right' ? 'text-right' : 'text-left')}
      style={{ color: 'var(--brand-text-muted)' }}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <td className={'px-4 py-3 text-[13px] ' + (align === 'right' ? 'text-right' : 'text-left')} style={{ color: 'var(--brand-text-secondary)' }}>
      {children}
    </td>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2 py-1.5 rounded-lg text-center" style={{ backgroundColor: 'var(--brand-background)' }}>
      <dt className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--brand-text-muted)' }}>
        {label}
      </dt>
      <dd className="font-bold mt-0.5" style={{ color: 'var(--brand-text-primary)' }}>
        {value}
      </dd>
    </div>
  );
}

function FooterMeta({ report }: { report: CohortReport }) {
  const fmt = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString();
    } catch {
      return iso;
    }
  };
  return (
    <p className="text-[11px] text-center" style={{ color: 'var(--brand-text-muted)' }}>
      {report.monthYear} · {fmt(report.windowStart)} → {fmt(report.windowEnd)} ({report.practiceTimezone}) ·{' '}
      {report.totalPatients} {report.totalPatients === 1 ? 'patient' : 'patients'}
    </p>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3" data-testid="cohort-skeleton">
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
