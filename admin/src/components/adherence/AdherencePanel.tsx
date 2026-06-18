'use client';

// Phase/25 — 90-day Medication Adherence Report panel.
//
// Header (icon + title + provisional badge + CSV/PDF), provisional
// disclaimer banner, filter card (window picker + practice dropdown for
// OPS/SUPER), KPI tiles, and the by-patient table. Same responsive language
// as ReportsPanel (max-w-1200, rounded-2xl cards, brand-shadow).

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Download,
  FileText,
  HeartPulse,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ADHERENCE_WINDOW_OPTIONS,
  downloadAdherenceCsv,
  downloadAdherencePdf,
  formatPct,
  getAdherenceReport,
  listReportPractices,
  type AdherenceReport,
  type ReportPractice,
} from '@/lib/services/adherence.service';
import { useAuth } from '@/lib/auth-context';

export default function AdherencePanel() {
  const { user, isLoading: authLoading } = useAuth();

  const [practices, setPractices] = useState<ReportPractice[]>([]);
  const [practiceId, setPracticeId] = useState<string>('');
  const [days, setDays] = useState<number>(90);
  const [picksLoaded, setPicksLoaded] = useState(false);

  const [report, setReport] = useState<AdherenceReport | null>(null);
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
      const data = await getAdherenceReport({ practiceId, days });
      setReport(data);
    } catch (e) {
      setReport(null);
      setLoadError(e instanceof Error ? e.message : 'Could not load report.');
    } finally {
      setLoading(false);
    }
  }, [practiceId, days]);

  useEffect(() => {
    if (!practiceId) return;
    void fetchReport();
  }, [practiceId, days, fetchReport]);

  const selectedPractice = useMemo(
    () => practices.find((p) => p.id === practiceId) ?? null,
    [practices, practiceId],
  );

  async function handleDownloadCsv() {
    if (!practiceId) return;
    setDownloadingCsv(true);
    try {
      await downloadAdherenceCsv({ practiceId, days });
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
      await downloadAdherencePdf({ practiceId, days });
      toast.success('PDF downloaded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'PDF download failed');
    } finally {
      setDownloadingPdf(false);
    }
  }

  const showPracticePicker = practices.length > 1;
  const windowLabel =
    ADHERENCE_WINDOW_OPTIONS.find((o) => o.value === days)?.label ??
    `${days} days`;
  const subtitle = selectedPractice?.name
    ? `${selectedPractice.name} · last ${windowLabel}`
    : `Medication adherence · last ${windowLabel}`;

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
            <HeartPulse className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1
              className="text-xl font-bold truncate"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              Medication adherence
            </h1>
            <p
              className="text-[12px] truncate"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:shrink-0 lg:justify-end">
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={!report || downloadingCsv}
            data-testid="adherence-download-csv"
            className="btn-admin-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            {downloadingCsv ? 'Downloading…' : 'CSV'}
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={!report || downloadingPdf}
            data-testid="adherence-download-pdf"
            className="btn-admin-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileText className="w-3.5 h-3.5 mr-1.5" />
            {downloadingPdf ? 'Downloading…' : 'PDF'}
          </button>
        </div>
      </div>

      {/* Provisional disclaimer banner */}
      <div
        className="flex items-start gap-2 rounded-xl px-3 py-2.5"
        style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
        role="note"
        data-testid="adherence-provisional-banner"
      >
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
        <p className="text-[12px] font-semibold leading-snug">
          Provisional — the adherence definition (target {report?.targetPct ?? 80}
          %, dose-not-due handling) is pending clinical sign-off from Dr. Singal.
          Treat these numbers as indicative, not final.
        </p>
      </div>

      {/* Filter card */}
      <div
        className="bg-white rounded-2xl p-3 sm:p-4"
        style={{ boxShadow: 'var(--brand-shadow-card)' }}
      >
        <div className="flex flex-row flex-wrap items-end gap-x-3 gap-y-2">
          {/* Window picker */}
          <div className="flex flex-col gap-1 min-w-0 sm:flex-row sm:items-center sm:gap-2">
            <label
              htmlFor="adherence-window"
              className="shrink-0 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              Window
            </label>
            <div className="relative w-full sm:w-auto">
              <select
                id="adherence-window"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                data-testid="adherence-window-picker"
                className="appearance-none h-9 pl-3 pr-8 rounded-full text-[12px] font-semibold outline-none cursor-pointer w-full sm:w-[160px]"
                style={{
                  backgroundColor: 'white',
                  color: 'var(--brand-text-primary)',
                  border: '1.5px solid var(--brand-border)',
                }}
              >
                {ADHERENCE_WINDOW_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    Last {o.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                style={{ color: 'var(--brand-text-muted)' }}
              />
            </div>
          </div>

          {/* Practice picker — only when caller has more than one */}
          {showPracticePicker && (
            <div className="flex flex-col gap-1 min-w-0 sm:flex-row sm:items-center sm:gap-2">
              <label
                htmlFor="adherence-practice"
                className="shrink-0 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                Practice
              </label>
              <div className="relative w-full sm:w-auto">
                <select
                  id="adherence-practice"
                  value={practiceId}
                  onChange={(e) => setPracticeId(e.target.value)}
                  data-testid="adherence-practice-picker"
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
                data-testid="adherence-practice-locked"
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
          data-testid="adherence-error"
        >
          {loadError}
        </p>
      )}

      {!picksLoaded && <PanelSkeleton />}

      {picksLoaded && practices.length === 0 && !loadError && <EmptyAccess />}

      {picksLoaded && practices.length > 0 && loading && !report && (
        <PanelSkeleton />
      )}

      {picksLoaded && report && (
        <div className="relative space-y-5">
          <SummaryTiles report={report} />
          <PatientTable report={report} />
          <FooterMeta report={report} />

          {loading && (
            <div
              className="absolute inset-0 flex items-start justify-center pt-12 rounded-2xl pointer-events-none"
              style={{ backgroundColor: 'rgba(255, 255, 255, 0.55)' }}
              data-testid="adherence-refetch-overlay"
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

function SummaryTiles({ report }: { report: AdherenceReport }) {
  const o = report.overall;
  const tiles = [
    {
      label: 'Practice adherence',
      value: formatPct(o.practiceAdherencePct),
      caption: `${o.totalTakenCheckIns} of ${o.totalDueCheckIns} due check-ins`,
    },
    {
      label: 'Below target',
      value: String(o.patientsBelowTarget),
      caption: `of ${o.patientsWithMeds} patients with meds`,
    },
    {
      label: 'Reporting',
      value: String(o.patientsReporting),
      caption: `${o.patientsNoData} with no data`,
    },
    {
      label: 'Missed doses',
      value: String(o.totalMissedDoses),
      caption: 'self-reported in window',
    },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="p-4 rounded-2xl bg-white"
          style={{ boxShadow: 'var(--brand-shadow-card)' }}
        >
          <p
            className="text-[10px] font-semibold uppercase tracking-wider mb-1"
            style={{ color: 'var(--brand-primary-purple)' }}
          >
            {t.label}
          </p>
          <p
            className="text-2xl font-bold"
            style={{ color: 'var(--brand-text-primary)' }}
          >
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

function StatusChip({ status }: { status: AdherenceReport['byPatient'][number]['status'] }) {
  const map = {
    BELOW_TARGET: { label: 'Below target', bg: 'var(--brand-alert-red-light)', fg: 'var(--brand-alert-red)' },
    ON_TRACK: { label: 'On track', bg: '#DCFCE7', fg: '#15803D' },
    NO_DATA: { label: 'No data', bg: '#F1F5F9', fg: 'var(--brand-text-muted)' },
  } as const;
  const s = map[status];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

function PatientTable({ report }: { report: AdherenceReport }) {
  if (report.byPatient.length === 0) {
    return (
      <div
        className="bg-white rounded-2xl p-8 text-center"
        style={{ boxShadow: 'var(--brand-shadow-card)' }}
        data-testid="adherence-empty-patients"
      >
        <p className="text-sm font-semibold" style={{ color: 'var(--brand-text-muted)' }}>
          No patients with active medications in this practice.
        </p>
      </div>
    );
  }
  return (
    <div
      className="bg-white rounded-2xl overflow-hidden"
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse" data-testid="adherence-patient-table">
          <thead>
            <tr style={{ backgroundColor: '#F8FAFC' }}>
              <Th>Patient</Th>
              <Th>Status</Th>
              <Th align="right">Adherence</Th>
              <Th align="right">Due</Th>
              <Th align="right">Taken</Th>
              <Th align="right">Missed</Th>
            </tr>
          </thead>
          <tbody>
            {report.byPatient.map((p, i) => (
              <tr
                key={p.patientId}
                style={{ backgroundColor: i % 2 === 1 ? '#FAFBFF' : 'white' }}
              >
                <Td>
                  <span className="font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                    {p.name}
                  </span>
                </Td>
                <Td>
                  <StatusChip status={p.status} />
                </Td>
                <Td align="right">
                  <span
                    className="font-semibold"
                    style={{
                      color:
                        p.status === 'BELOW_TARGET'
                          ? 'var(--brand-alert-red)'
                          : 'var(--brand-text-primary)',
                    }}
                  >
                    {formatPct(p.adherencePct)}
                  </span>
                </Td>
                <Td align="right">{p.dueCheckIns}</Td>
                <Td align="right">{p.takenCheckIns}</Td>
                <Td align="right">{p.missedDosesTotal}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      className={
        'px-4 py-3 text-[10px] font-bold uppercase tracking-wider ' +
        (align === 'right' ? 'text-right' : 'text-left')
      }
      style={{ color: 'var(--brand-text-muted)' }}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <td
      className={
        'px-4 py-3 text-[13px] ' + (align === 'right' ? 'text-right' : 'text-left')
      }
      style={{ color: 'var(--brand-text-secondary)' }}
    >
      {children}
    </td>
  );
}

function FooterMeta({ report }: { report: AdherenceReport }) {
  const fmt = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString();
    } catch {
      return iso;
    }
  };
  return (
    <p className="text-[11px] text-center" style={{ color: 'var(--brand-text-muted)' }}>
      Window {fmt(report.windowStart)} → {fmt(report.windowEnd)} ({report.windowDays} days,{' '}
      {report.practiceTimezone}) · {report.overall.patientsWithMeds}{' '}
      {report.overall.patientsWithMeds === 1 ? 'patient' : 'patients'} with active meds
    </p>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3" data-testid="adherence-skeleton">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="p-4 rounded-2xl bg-white animate-pulse"
            style={{ boxShadow: 'var(--brand-shadow-card)' }}
          >
            <div className="h-2 rounded mb-3" style={{ width: '40%', backgroundColor: 'var(--brand-border)' }} />
            <div className="h-6 rounded" style={{ width: '60%', backgroundColor: 'var(--brand-border)' }} />
          </div>
        ))}
      </div>
      <div
        className="p-6 rounded-2xl bg-white animate-pulse"
        style={{ boxShadow: 'var(--brand-shadow-card)' }}
      >
        {[1, 2, 3, 4, 5].map((j) => (
          <div
            key={j}
            className="h-3 rounded mb-2"
            style={{ width: `${60 + j * 5}%`, backgroundColor: 'var(--brand-border)' }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyAccess() {
  return (
    <div
      className="bg-white rounded-2xl p-8 text-center"
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
      data-testid="adherence-no-practices"
    >
      <p className="text-sm font-semibold" style={{ color: 'var(--brand-text-muted)' }}>
        You don&apos;t have access to any practice reports yet.
      </p>
    </div>
  );
}
