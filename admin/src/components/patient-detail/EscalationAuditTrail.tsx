'use client';

// Flow I — Per-alert escalation audit trail (vertical timeline).
//
// Renders the canonical T+0 → T+4h → T+8h → T+24h → T+48h ladder as a
// vertical timeline. Each step surfaces:
//   • Recipients notified (role + count)
//   • Channels (push / email / phone / dashboard) — taken from the
//     EscalationEvent.notificationChannel + per-channel Notification rows
//   • Acknowledgment timestamp (green ✓ if completed, red dot if pending)
//   • After-hours flag, scheduled-for time, triggered-by-resolution flag
// Footer shows the resolution action + rationale (15-field audit view).

import {
  Check,
  Clock,
  AlertCircle,
  Smartphone,
  Mail,
  PhoneCall,
  LayoutDashboard,
  Moon,
  CheckCircle2,
  Users,
  Repeat,
} from 'lucide-react';
import type {
  PatientAlert,
  PatientAlertEscalationEvent,
  NotificationChannel,
} from '@/lib/services/patient-detail.service';

// ─── Canonical ladder ────────────────────────────────────────────────────────
// Mirrors the EscalationLevel + LadderStep enums from
// /backend/prisma/schema/escalation_event.prisma (BP / Tier 1 ladder).

interface LadderStep {
  code: string;
  label: string;
  /** Brief description shown under the step heading. */
  hint: string;
}

const BP_LADDER: LadderStep[] = [
  { code: 'T0', label: 'T+0', hint: 'Initial dispatch' },
  { code: 'T2H', label: 'T+2h', hint: 'Patient + caregiver reminder' },
  { code: 'T4H', label: 'T+4h', hint: 'Provider on-call' },
  { code: 'T8H', label: 'T+8h', hint: 'Provider + medical director' },
  { code: 'T24H', label: 'T+24h', hint: 'Care team escalation' },
  { code: 'T48H', label: 'T+48h', hint: 'Final escalation tier' },
];

const TIER2_LADDER: LadderStep[] = [
  { code: 'T0', label: 'T+0', hint: 'Initial dispatch' },
  { code: 'TIER2_48H', label: 'T+48h', hint: 'First Tier 2 reminder' },
  { code: 'TIER2_7D', label: 'T+7d', hint: 'One-week follow-up' },
  { code: 'TIER2_14D', label: 'T+14d', hint: 'Two-week escalation' },
];

function ladderFor(tier: string | null): LadderStep[] {
  return tier === 'TIER_2_DISCREPANCY' ? TIER2_LADDER : BP_LADDER;
}

// ─── Channel chrome ──────────────────────────────────────────────────────────

function channelChrome(c: NotificationChannel): {
  label: string;
  color: string;
  bg: string;
  icon: React.ReactNode;
} {
  switch (c) {
    case 'PUSH':
      return {
        label: 'Push',
        color: 'var(--brand-primary-purple)',
        bg: 'var(--brand-primary-purple-light)',
        icon: <Smartphone className="w-2.5 h-2.5" />,
      };
    case 'EMAIL':
      return {
        label: 'Email',
        color: 'var(--brand-accent-teal)',
        bg: 'var(--brand-accent-teal-light)',
        icon: <Mail className="w-2.5 h-2.5" />,
      };
    case 'PHONE':
      return {
        label: 'Phone',
        color: 'var(--brand-warning-amber)',
        bg: 'var(--brand-warning-amber-light)',
        icon: <PhoneCall className="w-2.5 h-2.5" />,
      };
    case 'DASHBOARD':
      return {
        label: 'Dashboard',
        color: 'var(--brand-text-secondary)',
        bg: 'var(--brand-background)',
        icon: <LayoutDashboard className="w-2.5 h-2.5" />,
      };
  }
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtRole(r: string): string {
  return r.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Props {
  alert: PatientAlert;
}

/**
 * Per-alert escalation audit trail. Renders BOTH the canonical ladder steps
 * (so empty steps stay visible as "not yet triggered") AND any extra events
 * that don't fit a known step (e.g. T+4h retries from BP_L2_UNABLE_TO_REACH).
 */
export default function EscalationAuditTrail({ alert }: Props) {
  const ladder = ladderFor(alert.tier);

  // Group events by ladder step. We accept either `ladderStep` (preferred,
  // explicit) OR `escalationLevel` (legacy LEVEL_1 / LEVEL_2 — fall back).
  const eventsByStep = new Map<string, PatientAlertEscalationEvent[]>();
  const extras: PatientAlertEscalationEvent[] = [];
  const knownCodes = new Set(ladder.map((s) => s.code));

  for (const e of alert.escalationEvents) {
    const code = e.ladderStep ?? e.escalationLevel;
    if (knownCodes.has(code)) {
      const list = eventsByStep.get(code) ?? [];
      list.push(e);
      eventsByStep.set(code, list);
    } else {
      extras.push(e);
    }
  }

  return (
    <div className="rounded-lg p-4 bg-white" style={{ border: '1px solid var(--brand-border)' }}>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <p className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
          Escalation audit trail
        </p>
        <p className="text-[10.5px] font-mono" style={{ color: 'var(--brand-text-muted)' }}>
          alert {alert.id.slice(0, 8)}…
        </p>
      </div>

      {/* Vertical timeline */}
      <ol className="relative space-y-0">
        {ladder.map((step, i) => {
          const events = eventsByStep.get(step.code) ?? [];
          const last = i === ladder.length - 1;
          return (
            <Step
              key={step.code}
              step={step}
              events={events}
              isLast={last && extras.length === 0}
            />
          );
        })}
        {/* Extra (off-ladder) events — usually BP_L2 retry escalations */}
        {extras.map((e, i) => (
          <Step
            key={`extra-${e.id}`}
            step={{
              code: e.ladderStep ?? e.escalationLevel,
              label: e.ladderStep ?? e.escalationLevel,
              hint: e.triggeredByResolution ? 'Retry triggered by resolution' : 'Off-ladder escalation',
            }}
            events={[e]}
            isLast={i === extras.length - 1}
          />
        ))}
      </ol>

      {/* Resolution + 15-field audit footer */}
      {alert.status === 'RESOLVED' && <ResolutionAuditFooter alert={alert} />}
    </div>
  );
}

// ─── Single step ────────────────────────────────────────────────────────────

function Step({
  step,
  events,
  isLast,
}: {
  step: LadderStep;
  events: PatientAlertEscalationEvent[];
  isLast: boolean;
}) {
  const triggered = events.length > 0;
  // A step is "complete" when at least one event has an acknowledgedAt.
  const acked = events.some((e) => e.acknowledgedAt);
  const allResolved = triggered && events.every((e) => e.resolvedAt);

  let nodeColor: string;
  let nodeBg: string;
  let nodeIcon: React.ReactNode;
  let nodeLabel: string;

  if (allResolved) {
    nodeColor = 'var(--brand-success-green)';
    nodeBg = 'var(--brand-success-green-light)';
    nodeIcon = <CheckCircle2 className="w-3 h-3" />;
    nodeLabel = 'Completed';
  } else if (acked) {
    nodeColor = 'var(--brand-accent-teal)';
    nodeBg = 'var(--brand-accent-teal-light)';
    nodeIcon = <Check className="w-3 h-3" />;
    nodeLabel = 'Acknowledged';
  } else if (triggered) {
    nodeColor = 'var(--brand-alert-red)';
    nodeBg = 'var(--brand-alert-red-light)';
    nodeIcon = <AlertCircle className="w-3 h-3" />;
    nodeLabel = 'Awaiting acknowledgment';
  } else {
    nodeColor = 'var(--brand-text-muted)';
    nodeBg = 'var(--brand-background)';
    nodeIcon = <Clock className="w-3 h-3" />;
    nodeLabel = 'Not yet triggered';
  }

  return (
    <li className="relative pl-9 pb-4">
      {/* Vertical connector line */}
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[14px] top-7 bottom-0 w-0.5"
          style={{ backgroundColor: triggered ? nodeColor : 'var(--brand-border)', opacity: triggered ? 0.35 : 1 }}
        />
      )}
      {/* Node circle */}
      <span
        aria-hidden
        className="absolute left-0 top-0 w-7 h-7 rounded-full flex items-center justify-center"
        style={{
          backgroundColor: triggered ? nodeColor : 'white',
          color: triggered ? 'white' : nodeColor,
          border: `2px solid ${nodeColor}`,
        }}
      >
        {nodeIcon}
      </span>

      {/* Heading row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-[12.5px] font-bold leading-tight" style={{ color: 'var(--brand-text-primary)' }}>
            {step.label}
            <span className="ml-2 text-[11px] font-normal" style={{ color: 'var(--brand-text-muted)' }}>
              {step.hint}
            </span>
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ backgroundColor: nodeBg, color: nodeColor }}
        >
          {nodeIcon}
          {nodeLabel}
        </span>
      </div>

      {/* Per-event detail blocks */}
      {events.length === 0 ? (
        <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--brand-text-muted)' }}>
          No notifications dispatched for this step yet.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {events.map((e) => (
            <EventDetail key={e.id} event={e} />
          ))}
        </div>
      )}
    </li>
  );
}

// ─── Event detail ────────────────────────────────────────────────────────────

function EventDetail({ event }: { event: PatientAlertEscalationEvent }) {
  // Distinct channels — prefer per-Notification rows, fall back to the
  // event's single channel if no notifications were materialised.
  const channels = new Set<NotificationChannel>();
  for (const n of event.notifications) channels.add(n.channel);
  if (channels.size === 0 && event.notificationChannel) {
    channels.add(event.notificationChannel);
  }

  return (
    <div
      className="rounded-md p-2.5"
      style={{ backgroundColor: 'var(--brand-background)', border: '1px solid var(--brand-border)' }}
    >
      {/* Triggered / scheduled / acked timestamps */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mb-2">
        <KV label="Triggered" value={fmtDateTime(event.triggeredAt)} />
        {event.scheduledFor && (
          <KV label="Scheduled for" value={fmtDateTime(event.scheduledFor)} />
        )}
        <KV
          label="Acknowledged"
          value={fmtDateTime(event.acknowledgedAt)}
          valueColor={
            event.acknowledgedAt ? 'var(--brand-success-green)' : 'var(--brand-alert-red)'
          }
        />
        {event.resolvedAt && (
          <KV label="Resolved" value={fmtDateTime(event.resolvedAt)} valueColor="var(--brand-success-green)" />
        )}
      </div>

      {/* Recipients + channels */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        {/* Recipients */}
        <div className="inline-flex items-center gap-1.5">
          <Users className="w-3 h-3" style={{ color: 'var(--brand-text-muted)' }} />
          {event.recipientRoles.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {event.recipientRoles.map((role, i) => (
                <span
                  key={`${role}-${i}`}
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: 'var(--brand-primary-purple-light)',
                    color: 'var(--brand-primary-purple)',
                  }}
                >
                  {fmtRole(role)}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
              No recipients recorded
            </span>
          )}
          {event.recipientIds.length > 0 && (
            <span className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>
              · {event.recipientIds.length} {event.recipientIds.length === 1 ? 'person' : 'people'}
            </span>
          )}
        </div>

        {/* Channels */}
        {channels.size > 0 && (
          <div className="inline-flex items-center gap-1 flex-wrap">
            {Array.from(channels).map((c) => {
              const ch = channelChrome(c);
              return (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: ch.bg, color: ch.color }}
                >
                  {ch.icon}
                  {ch.label}
                </span>
              );
            })}
          </div>
        )}

        {/* After-hours flag */}
        {event.afterHours && (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)' }}
            title="Triggered outside business hours — backup recipient list applied"
          >
            <Moon className="w-2.5 h-2.5" />
            After-hours
          </span>
        )}

        {/* BP_L2 retry marker */}
        {event.triggeredByResolution && (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'var(--brand-primary-purple-light)', color: 'var(--brand-primary-purple)' }}
            title="Scheduled by an admin's BP_L2_UNABLE_TO_REACH_RETRY action"
          >
            <Repeat className="w-2.5 h-2.5" />
            Retry
          </span>
        )}
      </div>

      {/* Reason note (clinician-supplied or auto-generated) */}
      {event.reason && (
        <p className="text-[11.5px] mt-2 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
          {event.reason}
        </p>
      )}
    </div>
  );
}

// ─── 15-field audit footer ──────────────────────────────────────────────────

function ResolutionAuditFooter({ alert }: { alert: PatientAlert }) {
  // The 15 Joint-Commission audit fields (per CLAUDE.md). We surface every
  // field we currently have available; missing fields render as "—" so the
  // structure stays predictable.
  const fields: { label: string; value: string }[] = [
    { label: 'Alert ID', value: alert.id },
    { label: 'Tier', value: prettify(alert.tier) },
    { label: 'Rule ID', value: alert.ruleId ?? '—' },
    { label: 'Severity', value: prettify(alert.severity) },
    { label: 'Mode', value: prettify(alert.mode) },
    { label: 'Status', value: prettify(alert.status) },
    { label: 'Created', value: fmtDateTime(alert.createdAt) },
    { label: 'Resolved', value: fmtDateTime(alert.acknowledgedAt) },
    { label: 'Resolved by', value: alert.resolvedBy ?? '—' },
    { label: 'Resolution action', value: prettify(alert.resolutionAction) },
    { label: 'Reading', value: alert.journalEntry?.systolicBP != null ? `${alert.journalEntry.systolicBP}/${alert.journalEntry.diastolicBP} mmHg` : '—' },
    { label: 'Pulse pressure', value: alert.pulsePressure != null ? `${alert.pulsePressure} mmHg` : '—' },
    { label: 'Baseline value', value: alert.baselineValue != null ? String(alert.baselineValue) : '—' },
    { label: 'Actual value', value: alert.actualValue != null ? String(alert.actualValue) : '—' },
    { label: 'Escalation count', value: String(alert.escalationEvents.length) },
  ];

  return (
    <div
      className="mt-4 rounded-lg p-3.5"
      style={{
        backgroundColor: 'var(--brand-success-green-light)',
        border: '1px solid var(--brand-success-green)',
      }}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'var(--brand-success-green)' }} />
        <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-success-green)' }}>
          Resolution audit · 15-field record
        </p>
      </div>

      {/* Fixed two-column key/value grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1.5 mb-3">
        {fields.map((f) => (
          <div key={f.label} className="flex items-baseline gap-2 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider shrink-0" style={{ color: 'var(--brand-text-muted)' }}>
              {f.label}
            </span>
            <span className="text-[11.5px] font-mono truncate" style={{ color: 'var(--brand-text-primary)' }}>
              {f.value}
            </span>
          </div>
        ))}
      </div>

      {/* Free-form rationale */}
      {alert.resolutionRationale && (
        <div className="rounded-md bg-white p-2.5" style={{ border: '1px solid var(--brand-border)' }}>
          <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: 'var(--brand-success-green)' }}>
            Clinical rationale
          </p>
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--brand-text-primary)' }}>
            {alert.resolutionRationale}
          </p>
        </div>
      )}
    </div>
  );
}

function KV({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="text-[10px] font-bold uppercase tracking-wider shrink-0" style={{ color: 'var(--brand-text-muted)' }}>
        {label}
      </span>
      <span
        className="text-[11.5px] truncate"
        style={{ color: valueColor ?? 'var(--brand-text-primary)', fontWeight: valueColor ? 600 : 400 }}
      >
        {value}
      </span>
    </div>
  );
}

function prettify(v: string | null | undefined): string {
  if (!v) return '—';
  return v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
