'use client';

// Phase/24 — Top-of-report 4-KPI tile cluster.
// Mirrors the patient-detail "Quick Stats" grid: 2-col on mobile, 4-col on
// lg+. Each tile = small icon + uppercase label + big number.

import { AlertTriangle, BarChart3, Clock, ShieldAlert } from 'lucide-react';
import type { MonthlyReportOverall } from '@cardioplace/shared';
import { formatDuration } from '@/lib/services/reports.service';

interface Props {
  overall: MonthlyReportOverall;
}

function Tile({
  icon: Icon,
  iconColor,
  label,
  value,
  caption,
  testId,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  iconColor: string;
  label: string;
  value: string;
  caption?: string;
  testId: string;
}) {
  return (
    <div
      className="p-4 rounded-2xl bg-white"
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
      data-testid={testId}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5" style={{ color: iconColor }} />
        <p
          className="text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          {label}
        </p>
      </div>
      <p
        className="text-2xl font-bold leading-tight"
        style={{ color: 'var(--brand-text-primary)' }}
      >
        {value}
      </p>
      {caption && (
        <p className="text-[11px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
          {caption}
        </p>
      )}
    </div>
  );
}

export default function ReportSummaryTiles({ overall }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Tile
        icon={BarChart3}
        iconColor="var(--brand-primary-purple)"
        label="Total alerts"
        value={String(overall.totalAlerts)}
        caption={`${overall.resolved} resolved`}
        testId="report-tile-total"
      />
      <Tile
        icon={Clock}
        iconColor="var(--brand-success-green)"
        label="Acked in SLA"
        value={`${overall.acknowledgedInWindowPct}%`}
        caption={`${overall.acknowledgedInWindow} of ${overall.totalAlerts}`}
        testId="report-tile-acked"
      />
      <Tile
        icon={AlertTriangle}
        iconColor="var(--brand-warning-amber-text)"
        label="Escalated"
        value={`${overall.escalatedPct}%`}
        caption={`${overall.escalated} alerts`}
        testId="report-tile-escalated"
      />
      <Tile
        icon={ShieldAlert}
        iconColor="var(--brand-accent-teal)"
        label="Mean resolve"
        value={formatDuration(overall.meanResolveSeconds)}
        caption={`Mean ack ${formatDuration(overall.meanAckSeconds)}`}
        testId="report-tile-resolve"
      />
    </div>
  );
}
