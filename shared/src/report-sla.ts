// Phase/24 — SLA windows for the Monthly Practice Analytics Report.
//
// Per-tier "acknowledge within" target the report uses to compute the
// "% acknowledged in window" KPI. Numbers are minutes. The matching report
// also uses these to flag individual late alerts in the per-tier table.
//
// Source of truth — keep in sync with docs/CLINICAL_SPEC.md §8 (Monthly
// Reporting SLAs, awaiting Dr. Singal sign-off). When the spec lands these
// constants are the only knob; backend and frontend both read from here.
//
// Defaults below are sensible v1 placeholders derived from the existing
// escalation ladder offsets (T+N rungs) so we never set a target stricter
// than the rung that escalates the alert anyway.

import type { AlertTierValue } from './rule-ids.js';

/** Minutes from `DeviationAlert.createdAt` within which an alert is
 *  considered acknowledged-in-window for the monthly report. */
export const TIER_SLA_MINUTES: Record<AlertTierValue, number> = {
  // BP Level 2 — emergency, alerts wake the on-call. Ladder T+0 immediate.
  BP_LEVEL_2: 15,
  BP_LEVEL_2_SYMPTOM_OVERRIDE: 15,
  // Tier 1 contraindication — clinical-priority same-shift response.
  TIER_1_CONTRAINDICATION: 60,
  // Cluster 8 angioedema — airway emergency, compressed ladder.
  TIER_1_ANGIOEDEMA: 15,
  // BP Level 1 — clinically meaningful but not emergent.
  BP_LEVEL_1_HIGH: 24 * 60,
  BP_LEVEL_1_LOW: 24 * 60,
  // Tier 2 — medication discrepancy; review within 2 business days.
  TIER_2_DISCREPANCY: 48 * 60,
  // Tier 3 — informational; weekly cadence is fine.
  TIER_3_INFO: 7 * 24 * 60,
};

/**
 * Task 3 — per-tier "resolve within" target (minutes from
 * `DeviationAlert.createdAt`). PARALLEL to TIER_SLA_MINUTES, which is an
 * *acknowledge*-within target — resolution is a separate, later milestone, so
 * it needs its own targets. These are PROVISIONAL placeholders derived from
 * each tier's last escalation rung (the natural "should be closed by" point)
 * and, like the ack targets, await Dr. Singal sign-off (docs/CLINICAL_SPEC.md
 * §8). Single source of truth — backend + frontend both read from here.
 */
export const TIER_RESOLVE_SLA_MINUTES: Record<AlertTierValue, number> = {
  // Emergencies — resolve within the hour.
  BP_LEVEL_2: 60,
  BP_LEVEL_2_SYMPTOM_OVERRIDE: 60,
  TIER_1_ANGIOEDEMA: 60,
  // Clinical-priority contraindication — same shift.
  TIER_1_CONTRAINDICATION: 4 * 60,
  // BP Level 1 — within two days.
  BP_LEVEL_1_HIGH: 48 * 60,
  BP_LEVEL_1_LOW: 48 * 60,
  // Tier 2 discrepancy — matches the TIER2_14D ladder end.
  TIER_2_DISCREPANCY: 14 * 24 * 60,
  // Tier 3 informational — within a month.
  TIER_3_INFO: 30 * 24 * 60,
};

/**
 * The "escalated" KPI counts any alert whose escalation walked past T+0,
 * i.e. the program had to follow up after the initial dispatch failed to
 * close the alert. Matches the rungs defined in `LadderStep` in Prisma.
 */
export const ESCALATED_LADDER_STEPS = [
  'T15M',
  'T1H',
  'T2H',
  'T4H',
  'T8H',
  'T24H',
  'T48H',
  'T72H',
  'T7D',
  'TIER2_48H',
  'TIER2_7D',
  'TIER2_14D',
] as const;

export type EscalatedLadderStep = (typeof ESCALATED_LADDER_STEPS)[number];

export function isEscalatedStep(
  step: string | null | undefined,
): step is EscalatedLadderStep {
  if (!step) return false;
  return (ESCALATED_LADDER_STEPS as readonly string[]).includes(step);
}
