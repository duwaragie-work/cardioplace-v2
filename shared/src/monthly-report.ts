// Phase/24 — Monthly Practice Analytics Report payload shape.
//
// Backend `ReportsService.generateMonthly` returns this shape and persists
// it verbatim in `MonthlyReportSnapshot.payload`. Frontend reports page
// consumes it directly — single source of truth for the wire format.

import type { AlertTierValue } from './rule-ids.js';

export interface TierBreakdownRow {
  tier: AlertTierValue;
  total: number;
  acknowledgedInWindow: number;
  escalated: number;
  resolved: number;
  /** Mean time from `createdAt` → `acknowledgedAt`, in seconds. null when
   *  no alert in this tier was acknowledged in the window. */
  meanAckSeconds: number | null;
  /** Mean time from `createdAt` → `resolvedAt`, in seconds. null when
   *  no alert in this tier was resolved in the window. */
  meanResolveSeconds: number | null;
}

export interface ProviderLeaderboardRow {
  /** Provider user id. May be null for the "Auto-escalation / system"
   *  bucket if alerts were resolved by the cron with no human actor. */
  providerId: string | null;
  /** Display name resolved server-side. Falls back to email or
   *  "(unknown)" when both are missing. */
  name: string;
  /** Count of alerts where this provider acknowledged or resolved at
   *  least one event. */
  alertsTouched: number;
  acknowledgedCount: number;
  resolvedCount: number;
  meanAckSeconds: number | null;
}

export interface MonthlyReportOverall {
  totalAlerts: number;
  acknowledgedInWindow: number;
  acknowledgedInWindowPct: number;
  escalated: number;
  escalatedPct: number;
  resolved: number;
  resolvedPct: number;
  meanAckSeconds: number | null;
  meanResolveSeconds: number | null;
  /** Total patients currently assigned to this practice (count of
   *  `PatientProviderAssignment` rows). Snapshotted at report-generation
   *  time, not at window end — patient roster doesn't carry per-day
   *  history in this model. */
  totalPatients: number;
}

export interface MonthlyReport {
  /** Practice this report covers. */
  practiceId: string;
  practiceName: string;
  /** Month identifier (YYYY-MM) interpreted in the practice's
   *  businessHoursTimezone — not UTC. */
  monthYear: string;
  /** ISO 8601 timestamps marking the half-open window
   *  [windowStart, windowEnd) used to filter alerts by `createdAt`. */
  windowStart: string;
  windowEnd: string;
  practiceTimezone: string;
  /** ISO 8601 timestamp at which this snapshot was computed. Cached
   *  snapshots keep their original value; fresh-compute requests set
   *  this to "now". */
  generatedAt: string;
  /** True when this payload was read from MonthlyReportSnapshot rather
   *  than recomputed on demand. */
  cached: boolean;
  overall: MonthlyReportOverall;
  byTier: TierBreakdownRow[];
  byProvider: ProviderLeaderboardRow[];
}
