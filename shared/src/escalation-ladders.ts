// B.3 — canonical escalation-ladder DISPLAY shapes, shared by the admin
// timeline (EscalationAuditTrail) and guarded against the backend ladder
// definitions (ladder-defs.ts) so the two never drift.
//
// This is the DISPLAY contract (ordered step codes + labels + hint text the
// admin renders per tier). The backend's LadderStep carries richer dispatch
// detail (offsets, recipientRoles, channels); a guard test asserts the
// backend's per-tier ORDERED STEP CODES match `LADDER_STEP_CODES` here, so a
// step added/removed/reordered on either side fails CI instead of silently
// rendering a phantom "Not yet triggered" row.

export interface LadderDisplayStep {
  code: string
  label: string
  /** Brief description shown under the step heading in the admin timeline. */
  hint: string
}

export const TIER_1_LADDER_DISPLAY: LadderDisplayStep[] = [
  { code: 'T0', label: 'T+0', hint: 'Primary provider notified' },
  { code: 'T4H', label: 'T+4h', hint: 'Primary + backup re-notified' },
  { code: 'T8H', label: 'T+8h', hint: 'Medical director paged' },
  { code: 'T24H', label: 'T+24h', hint: 'Healplace ops escalation' },
  { code: 'T48H', label: 'T+48h', hint: 'Final compliance review' },
]

// Cluster 8 — ACE-angioedema compressed ladder (never queues for business
// hours; airway obstruction progresses within hours).
export const TIER_1_ANGIOEDEMA_LADDER_DISPLAY: LadderDisplayStep[] = [
  { code: 'T0', label: 'T+0', hint: 'Primary provider notified' },
  { code: 'T15M', label: 'T+15m', hint: 'Backup provider paged' },
  { code: 'T1H', label: 'T+1h', hint: 'Medical director + Healplace ops' },
  { code: 'T4H', label: 'T+4h', hint: 'Healplace ops final' },
]

export const TIER_2_LADDER_DISPLAY: LadderDisplayStep[] = [
  { code: 'T0', label: 'T+0', hint: 'Dashboard badge' },
  { code: 'TIER2_48H', label: 'T+48h', hint: 'First Tier 2 reminder' },
  { code: 'TIER2_7D', label: 'T+7d', hint: 'Backup provider follow-up' },
  { code: 'TIER2_14D', label: 'T+14d', hint: 'Healplace ops compliance' },
]

export const BP_LEVEL_1_LADDER_DISPLAY: LadderDisplayStep[] = [
  { code: 'T0', label: 'T+0', hint: 'Primary provider + patient' },
  { code: 'T24H', label: 'T+24h', hint: 'Primary + backup notified' },
  { code: 'T72H', label: 'T+72h', hint: 'Medical director' },
  { code: 'T7D', label: 'T+7d', hint: 'Healplace ops compliance' },
]

export const BP_LEVEL_2_LADDER_DISPLAY: LadderDisplayStep[] = [
  { code: 'T0', label: 'T+0', hint: 'Primary + backup + patient' },
  { code: 'T2H', label: 'T+2h', hint: 'Medical director' },
  { code: 'T4H', label: 'T+4h', hint: 'Healplace ops phone' },
]

/** Display ladder for an alert tier. Empty array = Tier 3 / unknown (no ladder). */
export function ladderDisplayForTier(tier: string | null): LadderDisplayStep[] {
  switch (tier) {
    case 'TIER_1_CONTRAINDICATION':
      return TIER_1_LADDER_DISPLAY
    case 'TIER_1_ANGIOEDEMA':
      return TIER_1_ANGIOEDEMA_LADDER_DISPLAY
    case 'TIER_2_DISCREPANCY':
      return TIER_2_LADDER_DISPLAY
    case 'BP_LEVEL_1_HIGH':
    case 'BP_LEVEL_1_LOW':
      return BP_LEVEL_1_LADDER_DISPLAY
    case 'BP_LEVEL_2':
    case 'BP_LEVEL_2_SYMPTOM_OVERRIDE':
      return BP_LEVEL_2_LADDER_DISPLAY
    default:
      return []
  }
}

/**
 * Canonical ordered step codes per tier — the drift-guard contract. The
 * backend ladder-defs guard test maps its LadderStep[] to `.step` codes and
 * asserts equality with these arrays.
 */
export const LADDER_STEP_CODES: Record<string, string[]> = {
  TIER_1_CONTRAINDICATION: TIER_1_LADDER_DISPLAY.map((s) => s.code),
  TIER_1_ANGIOEDEMA: TIER_1_ANGIOEDEMA_LADDER_DISPLAY.map((s) => s.code),
  TIER_2_DISCREPANCY: TIER_2_LADDER_DISPLAY.map((s) => s.code),
  BP_LEVEL_1_HIGH: BP_LEVEL_1_LADDER_DISPLAY.map((s) => s.code),
  BP_LEVEL_1_LOW: BP_LEVEL_1_LADDER_DISPLAY.map((s) => s.code),
  BP_LEVEL_2: BP_LEVEL_2_LADDER_DISPLAY.map((s) => s.code),
  BP_LEVEL_2_SYMPTOM_OVERRIDE: BP_LEVEL_2_LADDER_DISPLAY.map((s) => s.code),
}
