'use client';

// Task 2 — Quarterly Outcomes panel.
//
// Quarter picker + practice dropdown, alert-volume trend (3 month cards),
// BP-control KPI tiles, and the by-patient control table. Same responsive
// language as the other report panels.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  Download,
  FileText,
  Loader2,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  currentQuarter,
  downloadQuarterlyCsv,
  downloadQuarterlyPdf,
  formatPct,
  getQuarterlyReport,
  listReportPractices,
  recentQuarters,
  type QuarterlyReport,
  type ReportPractice,
} from '@/lib/services/quarterly.service';
import { useAuth } from '@/lib/auth-context';

export default function QuarterlyPanel() {
  const { user, isLoading: authLoading } = useAuth();

  const [practices, setPractices] = useState<ReportPractice[]>([]);
  const [practiceId, setPracticeId] = useState<string>('');
  const [quarter, setQuarter] = useState<string>(currentQuarter());
  const [picksLoaded, setPicksLoaded] = useState(false);

  const [report, setReport] = useState<QuarterlyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const quarterOptions = useMemo(() => recentQuarters(8), []);

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
      const data = await getQuarterlyReport({ practiceId, quarter });
      setReport(data);
    } catch (e) {
      setReport(null);
      setLoadError(e instanceof Error ? e.message : 'Could not load report.');
    } finally {
      setLoading(false);
    }
  }, [practiceId, quarter]);

  useEffect(() => {
    if (!practiceId) return;
    void fetchReport();
  }, [practiceId, quarter, fetchReport]);

  const selectedPractice = useMemo(
    () => practices.find((p) => p.id === practiceId) ?? null,
    [practices, practiceId],
  );

  async function handleDownloadCsv() {
    if (!practiceId) return;
    setDownloadingCsv(true);
    try {
      await downloadQuarterlyCsv({ practiceId, quarter });
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
      await downloadQuarterlyPdf({ practiceId, quarter });
      toast.success('PDF downloaded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'PDF download failed');
    } finally {
      setDownloadingPdf(false);
    }
  }

  const showPracticePicker = practices.length > 1;
  const subtitle = selectedPractice?.name
    ? `${selectedPractice.name} · ${quarter}`
    : `Quarterly outcomes · ${quarter}`;

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
            <TrendingUp className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>
              Quarterly outcomes
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
            data-testid="quarterly-download-csv"
            className="btn-admin-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            {downloadingCsv ? 'Downloading…' : 'CSV'}
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={!report || downloadingPdf}
            data-testid="quarterly-download-pdf"
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
          {/* Quarter picker */}
          <div className="flex flex-col gap-1 min-w-0 flex-1 basis-[140px] sm:flex-row sm:items-center sm:gap-2 sm:basis-auto sm:flex-none">
            <label
              htmlFor="quarterly-quarter"
              className="shrink-0 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              Quarter
            </label>
            <div className="relative w-full sm:w-auto">
              <select
                id="quarterly-quarter"
                value={quarter}
                onChange={(e) => setQuarter(e.target.value)}
                data-testid="quarterly-quarter-picker"
                className="appearance-none h-9 pl-3 pr-8 rounded-full text-[12px] font-semibold outline-none cursor-pointer w-full sm:w-[150px]"
                style={{
                  backgroundColor: 'white',
                  color: 'var(--brand-text-primary)',
                  border: '1.5px solid var(--brand-border)',
                }}
              >
                {quarterOptions.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                style={{ color: 'var(--brand-text-muted)' }}
              />
            </div>
          </div>

          {showPracticePicker && (
            <div className="flex flex-col gap-1 min-w-0 flex-1 basis-[140px] sm:flex-row sm:items-center sm:gap-2 sm:basis-auto sm:flex-none">
              <label
                htmlFor="quarterly-practice"
                className="shrink-0 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                Practice
              </label>
              <div className="relative w-full sm:w-auto">
                <select
                  id="quarterly-practice"
                  value={practiceId}
                  onChange={(e) => setPracticeId(e.target.value)}
                  data-testid="quarterly-practice-picker"
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
                data-testid="quarterly-practice-locked"
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
          data-testid="quarterly-error"
        >
          {loadError}
        </p>
      )}

      {!picksLoaded && <PanelSkeleton />}
      {picksLoaded && practices.length === 0 && !loadError && <EmptyAccess />}
      {picksLoaded && practices.length > 0 && loading && !report && <PanelSkeleton />}

      {picksLoaded && report && (
        <div className="relative space-y-5">
          <AlertVolumeTrend report={report} />
          <ControlTiles report={report} />
          <ControlTable report={report} />
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

function AlertVolumeTrend({ report }: { report: QuarterlyReport }) {
  const max = Math.max(1, ...report.alertVolume.map((m) => m.totalAlerts));
  const summary = report.alertVolume
    .map((m) => `${m.label}: ${m.totalAlerts}`)
    .join(', ');
  return (
    <div
      className="bg-white rounded-2xl p-4 sm:p-5"
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <p
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--brand-primary-purple)' }}
        >
          Alert volume by month
        </p>
        <p className="text-[11px] font-semibold" style={{ color: 'var(--brand-text-muted)' }}>
          {report.totalAlertsInQuarter} this quarter
        </p>
      </div>

      {/* Bars sit on a shared baseline; heights are relative to the busiest
          month. Columns are flex-1 so the chart fills any width. */}
      <div
        className="flex items-end justify-between gap-4 sm:gap-8 h-36 sm:h-44 px-1"
        role="img"
        aria-label={`Alert volume by month — ${summary}`}
      >
        {report.alertVolume.map((m) => (
          <div
            key={m.monthYear}
            className="flex-1 flex flex-col items-center justify-end h-full"
          >
            <span
              className="text-sm font-bold mb-1.5"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              {m.totalAlerts}
            </span>
            <div
              className="w-full max-w-[72px] rounded-t-lg transition-all"
              style={{
                height: `${(m.totalAlerts / max) * 100}%`,
                minHeight: 6,
                background: 'linear-gradient(180deg, #9333EA, #7B00E0)',
              }}
            />
          </div>
        ))}
      </div>

      {/* Baseline + month labels aligned under each bar. */}
      <div
        className="border-t flex justify-between gap-4 sm:gap-8 pt-2 px-1"
        style={{ borderColor: 'var(--brand-border)' }}
      >
        {report.alertVolume.map((m) => (
          <span
            key={m.monthYear}
            className="flex-1 text-center text-[11px] font-medium"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {m.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ControlTiles({ report }: { report: QuarterlyReport }) {
  const c = report.control;
  const tiles = [
    { label: 'BP control rate', value: formatPct(c.controlRatePct), caption: `${c.controlled} of ${c.patientsWithReadings} patients` },
    { label: 'Not controlled', value: String(c.notControlled), caption: 'quarter-average above target' },
    { label: 'Controlled', value: String(c.controlled), caption: 'at/below target' },
    { label: 'With readings', value: String(c.patientsWithReadings), caption: 'in the quarter' },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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

function ControlChip({ status }: { status: QuarterlyReport['byPatient'][number]['status'] }) {
  const s =
    status === 'CONTROLLED'
      ? { label: 'Controlled', bg: '#DCFCE7', fg: '#15803D' }
      : { label: 'Not controlled', bg: 'var(--brand-alert-red-light)', fg: 'var(--brand-alert-red)' };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

function ControlTable({ report }: { report: QuarterlyReport }) {
  if (report.byPatient.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        <p className="text-sm font-semibold" style={{ color: 'var(--brand-text-muted)' }}>
          No patients with BP readings in this quarter.
        </p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
      {/* Desktop table — lg+ */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-left border-collapse" data-testid="quarterly-control-table">
          <thead>
            <tr style={{ backgroundColor: '#F8FAFC' }}>
              <Th>Patient</Th>
              <Th>Status</Th>
              <Th align="right">Average BP</Th>
              <Th align="right">Target (upper)</Th>
              <Th align="right">Readings</Th>
            </tr>
          </thead>
          <tbody>
            {report.byPatient.map((p, i) => (
              <tr key={p.patientId} style={{ backgroundColor: i % 2 === 1 ? '#FAFBFF' : 'white' }}>
                <Td>
                  <span className="font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                    {p.name}
                  </span>
                </Td>
                <Td>
                  <ControlChip status={p.status} />
                </Td>
                <Td align="right">
                  <span
                    className="font-semibold"
                    style={{
                      color: p.status === 'NOT_CONTROLLED' ? 'var(--brand-alert-red)' : 'var(--brand-text-primary)',
                    }}
                  >
                    {p.meanSystolic}/{p.meanDiastolic}
                  </span>
                </Td>
                <Td align="right">
                  {p.sbpUpper}/{p.dbpUpper}
                  {p.usedCustomTarget && (
                    <span style={{ color: 'var(--brand-primary-purple)' }} title="Provider-set target">
                      {' '}*
                    </span>
                  )}
                </Td>
                <Td align="right">{p.readings}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile / tablet cards — below lg */}
      <div className="lg:hidden">
        {report.byPatient.map((p, i) => (
          <div
            key={p.patientId}
            className="px-4 py-4"
            style={{ borderTop: i > 0 ? '1px solid var(--brand-border)' : undefined }}
          >
            <div className="flex items-center justify-between gap-3 mb-3 min-w-0">
              <span
                className="text-[13px] font-semibold truncate"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                {p.name}
              </span>
              <ControlChip status={p.status} />
            </div>
            <dl className="grid grid-cols-3 gap-2 text-[11px]">
              <Stat label="Average BP" value={`${p.meanSystolic}/${p.meanDiastolic}`} />
              <Stat
                label="Target"
                value={`${p.sbpUpper}/${p.dbpUpper}${p.usedCustomTarget ? ' *' : ''}`}
              />
              <Stat label="Readings" value={String(p.readings)} />
            </dl>
          </div>
        ))}
      </div>

      <div
        className="px-4 py-3 border-t text-[11px] leading-relaxed"
        style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-muted)' }}
      >
        <span className="font-semibold">Controlled</span> = the patient&apos;s quarter-average
        systolic <em>and</em> diastolic are at or below their upper target.{' '}
        <span className="font-semibold">Target</span> is the provider-set value when present
        (<span style={{ color: 'var(--brand-primary-purple)' }}>*</span>), otherwise the default
        140/90.
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
    <td
      className={'px-4 py-3 text-[13px] ' + (align === 'right' ? 'text-right' : 'text-left')}
      style={{ color: 'var(--brand-text-secondary)' }}
    >
      {children}
    </td>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="px-2 py-1.5 rounded-lg text-center"
      style={{ backgroundColor: 'var(--brand-background)' }}
    >
      <dt
        className="text-[10px] uppercase tracking-wider font-semibold"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        {label}
      </dt>
      <dd className="font-bold mt-0.5" style={{ color: 'var(--brand-text-primary)' }}>
        {value}
      </dd>
    </div>
  );
}

function FooterMeta({ report }: { report: QuarterlyReport }) {
  const fmt = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString();
    } catch {
      return iso;
    }
  };
  return (
    <p className="text-[11px] text-center" style={{ color: 'var(--brand-text-muted)' }}>
      {report.quarter} · {fmt(report.windowStart)} → {fmt(report.windowEnd)} ({report.practiceTimezone})
    </p>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3" data-testid="quarterly-skeleton">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
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
