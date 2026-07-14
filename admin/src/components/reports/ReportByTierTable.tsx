'use client';

// Phase/24 — Per-tier breakdown. Desktop table; stacked cards on small.
// Style mirrors the user-management list (white card, rounded-2xl, subtle
// shadow). Severity color drives the leading dot per row.

import type { TierBreakdownRow } from '@cardioplace/shared';
import {
  formatDuration,
  formatTierLabel,
  tierSeverityColor,
} from '@/lib/services/reports.service';

interface Props {
  rows: TierBreakdownRow[];
}

// Manisha Open-Decisions sign-off 2026-06-06 (Decision 1) — Tier 3 = info-blue.
// `teal` slot retained for back-compat with anything still mapped that way,
// but `tierSeverityColor` now returns 'blue' for TIER_3_INFO.
const SEVERITY_PALETTE: Record<
  'red' | 'amber' | 'blue' | 'teal' | 'muted',
  { dot: string; chip: string; chipText: string }
> = {
  red: {
    dot: 'var(--brand-alert-red)',
    chip: 'var(--brand-alert-red-light)',
    chipText: 'var(--brand-alert-red-text)',
  },
  amber: {
    dot: 'var(--brand-warning-amber)',
    chip: 'var(--brand-warning-amber-light)',
    chipText: 'var(--brand-warning-amber-text)',
  },
  blue: {
    dot: 'var(--brand-info-blue)',
    chip: 'var(--brand-info-blue-light)',
    chipText: 'var(--brand-info-blue)',
  },
  teal: {
    dot: 'var(--brand-accent-teal)',
    chip: 'var(--brand-accent-teal-light)',
    chipText: 'var(--brand-accent-teal)',
  },
  muted: {
    dot: 'var(--brand-border)',
    chip: 'var(--brand-background)',
    chipText: 'var(--brand-text-muted)',
  },
};

function pct(part: number, whole: number): string {
  if (whole === 0) return '—';
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

export default function ReportByTierTable({ rows }: Props) {
  // Always show every tier — even zero-total ones. A "0" for Tier 1
  // Contraindication is itself a useful clinical signal ("nothing in
  // this category this month") and keeps the table layout stable so
  // readers compare months without rows shifting.
  const activeCount = rows.filter((r) => r.total > 0).length;
  const totalAlerts = rows.reduce((s, r) => s + r.total, 0);

  return (
    <section
      className="bg-white rounded-2xl overflow-hidden"
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
      aria-label="Per-tier breakdown"
      data-testid="report-by-tier"
    >
      <div
        className="px-5 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--brand-border)' }}
      >
        <h2
          className="text-[13px] font-bold uppercase tracking-wider"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          By tier
        </h2>
        <span
          className="text-[11px]"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          {totalAlerts} {totalAlerts === 1 ? 'alert' : 'alerts'} · {activeCount}/{rows.length} tiers active
        </span>
      </div>

      {/* Desktop table — lg+ */}
      <div className="hidden lg:block overflow-x-auto">
          <table className="w-full">
            <thead style={{ backgroundColor: 'var(--brand-background)' }}>
              <tr>
                <th
                  scope="col"
                  className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Tier
                </th>
                <th
                  scope="col"
                  className="text-right px-3 py-3 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Total
                </th>
                <th
                  scope="col"
                  className="text-right px-3 py-3 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Acked in SLA
                </th>
                <th
                  scope="col"
                  className="text-right px-3 py-3 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Escalated
                </th>
                <th
                  scope="col"
                  className="text-right px-3 py-3 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Resolved
                </th>
                <th
                  scope="col"
                  className="text-right px-3 py-3 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Mean ack
                </th>
                <th
                  scope="col"
                  className="text-right px-5 py-3 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Mean resolve
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const palette = SEVERITY_PALETTE[tierSeverityColor(r.tier)];
                // Zero-total rows desaturate so real data stays visually
                // dominant while still being present for comparison.
                const isEmpty = r.total === 0;
                const nameColor = isEmpty
                  ? 'var(--brand-text-muted)'
                  : 'var(--brand-text-primary)';
                const cellColor = isEmpty
                  ? 'var(--brand-text-muted)'
                  : 'var(--brand-text-secondary)';
                return (
                  <tr
                    key={r.tier}
                    style={{ borderTop: '1px solid var(--brand-border)' }}
                  >
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{
                            backgroundColor: isEmpty
                              ? 'var(--brand-border)'
                              : palette.dot,
                          }}
                          aria-hidden
                        />
                        <span
                          className="text-[12px] font-semibold"
                          style={{ color: nameColor }}
                        >
                          {formatTierLabel(r.tier)}
                        </span>
                      </span>
                    </td>
                    <td
                      className="px-3 py-3 text-right text-[12px] font-semibold"
                      style={{ color: nameColor }}
                    >
                      {r.total}
                    </td>
                    <td
                      className="px-3 py-3 text-right text-[12px]"
                      style={{ color: cellColor }}
                    >
                      {isEmpty ? (
                        '—'
                      ) : (
                        <>
                          {r.acknowledgedInWindow}{' '}
                          <span
                            className="text-[10px]"
                            style={{ color: 'var(--brand-text-muted)' }}
                          >
                            ({pct(r.acknowledgedInWindow, r.total)})
                          </span>
                        </>
                      )}
                    </td>
                    <td
                      className="px-3 py-3 text-right text-[12px]"
                      style={{ color: cellColor }}
                    >
                      {isEmpty ? (
                        '—'
                      ) : (
                        <>
                          {r.escalated}{' '}
                          <span
                            className="text-[10px]"
                            style={{ color: 'var(--brand-text-muted)' }}
                          >
                            ({pct(r.escalated, r.total)})
                          </span>
                        </>
                      )}
                    </td>
                    <td
                      className="px-3 py-3 text-right text-[12px]"
                      style={{ color: cellColor }}
                    >
                      {isEmpty ? (
                        '—'
                      ) : (
                        <>
                          {r.resolved}{' '}
                          <span
                            className="text-[10px]"
                            style={{ color: 'var(--brand-text-muted)' }}
                          >
                            ({pct(r.resolved, r.total)})
                          </span>
                        </>
                      )}
                    </td>
                    <td
                      className="px-3 py-3 text-right text-[12px]"
                      style={{ color: cellColor }}
                    >
                      {formatDuration(r.meanAckSeconds)}
                    </td>
                    <td
                      className="px-5 py-3 text-right text-[12px]"
                      style={{ color: cellColor }}
                    >
                      {formatDuration(r.meanResolveSeconds)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      {/* Mobile / tablet cards */}
      <div className="lg:hidden">
        {rows.map((r, idx) => {
          const palette = SEVERITY_PALETTE[tierSeverityColor(r.tier)];
          const isEmpty = r.total === 0;
          const titleColor = isEmpty
            ? 'var(--brand-text-muted)'
            : 'var(--brand-text-primary)';
          return (
            <div
              key={r.tier}
              className="px-5 py-4"
              style={{
                borderTop:
                  idx > 0 ? '1px solid var(--brand-border)' : undefined,
              }}
            >
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="inline-flex items-center gap-2 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      backgroundColor: isEmpty
                        ? 'var(--brand-border)'
                        : palette.dot,
                    }}
                    aria-hidden
                  />
                  <span
                    className="text-[13px] font-semibold truncate"
                    style={{ color: titleColor }}
                  >
                    {formatTierLabel(r.tier)}
                  </span>
                </span>
                <span
                  className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: isEmpty
                      ? 'var(--brand-background)'
                      : palette.chip,
                    color: isEmpty
                      ? 'var(--brand-text-muted)'
                      : palette.chipText,
                  }}
                >
                  {r.total}
                </span>
              </div>
              {isEmpty ? (
                <p
                  className="text-[11px]"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  No alerts in this tier this month.
                </p>
              ) : (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
                  <Metric
                    label="Acked SLA"
                    value={`${r.acknowledgedInWindow} (${pct(r.acknowledgedInWindow, r.total)})`}
                  />
                  <Metric
                    label="Escalated"
                    value={`${r.escalated} (${pct(r.escalated, r.total)})`}
                  />
                  <Metric
                    label="Resolved"
                    value={`${r.resolved} (${pct(r.resolved, r.total)})`}
                  />
                  <Metric label="Mean ack" value={formatDuration(r.meanAckSeconds)} />
                  <Metric
                    label="Mean resolve"
                    value={formatDuration(r.meanResolveSeconds)}
                  />
                </dl>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 min-w-0">
      <dt
        className="text-[10px] uppercase tracking-wider font-semibold shrink-0"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        {label}
      </dt>
      <dd
        className="font-semibold truncate text-right"
        style={{ color: 'var(--brand-text-primary)' }}
      >
        {value}
      </dd>
    </div>
  );
}
