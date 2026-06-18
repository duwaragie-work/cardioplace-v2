// Task 3 — Alert-Resolution-Time SLA Report payload.
//
// A per-tier scorecard: target response time vs the actual average, with a
// Pass/Fail verdict, for both acknowledge and resolve milestones. Derived
// from the same monthly aggregation the Monthly report uses, so the numbers
// always agree. Targets come from TIER_SLA_MINUTES (ack) and
// TIER_RESOLVE_SLA_MINUTES (resolve) in report-sla.ts.
//
// ⚠️ The SLA target times are PROVISIONAL placeholders pending Dr. Singal
// sign-off — the report carries `provisional: true`.

import type { AlertTierValue } from './rule-ids.js';

export interface SlaTierRow {
  tier: AlertTierValue;
  /** Alerts of this tier in the window. */
  total: number;

  // ── Acknowledge ──────────────────────────────────────────────────────────
  /** Target "acknowledge within", in seconds. */
  ackTargetSeconds: number;
  /** Mean time to acknowledge, in seconds. null when none were acknowledged. */
  meanAckSeconds: number | null;
  /** % of this tier's alerts acknowledged inside the ack target. null when
   *  the tier had no alerts. */
  ackWithinPct: number | null;
  /** Pass = mean ack at/below target. null when there's no data to judge. */
  ackPass: boolean | null;

  // ── Resolve ──────────────────────────────────────────────────────────────
  /** Target "resolve within", in seconds. */
  resolveTargetSeconds: number;
  /** Mean time to resolve, in seconds. null when none were resolved. */
  meanResolveSeconds: number | null;
  /** Pass = mean resolve at/below target. null when there's no data. */
  resolvePass: boolean | null;
}

export interface SlaReport {
  practiceId: string;
  practiceName: string;
  /** Month identifier (YYYY-MM) in the practice timezone. */
  monthYear: string;
  windowStart: string;
  windowEnd: string;
  practiceTimezone: string;
  generatedAt: string;
  /** True while the SLA targets are provisional / pending sign-off. */
  provisional: boolean;
  /** Headline: % of all alerts acknowledged within their ack target. */
  overallAckWithinPct: number | null;
  /** Tiers that failed either target (mean over target), for a quick count. */
  tiersFailing: number;
  byTier: SlaTierRow[];
}
