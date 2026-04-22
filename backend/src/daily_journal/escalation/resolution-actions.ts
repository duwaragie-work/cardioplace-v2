// Phase/7 resolution-action catalog — the closed set of actions an admin can
// pick when resolving a DeviationAlert. Sourced from CLINICAL_SPEC §V2-D
// (Tier 1, Tier 2, BP Level 2 resolution tables).
//
// Rationale rule (user correction #2): required when tier ∈ {TIER_1_*,
// BP_LEVEL_2*} OR when the action itself is tagged `requiresRationale`. The
// catalog below encodes both — every Tier 1 + BP Level 2 action is tagged
// required, plus the Tier 2 "reviewed, no action" outlier.

export type ResolutionAction =
  // ── Tier 1 (Contraindication / safety-critical) ──
  | 'TIER1_DISCONTINUED'
  | 'TIER1_CHANGE_ORDERED'
  | 'TIER1_FALSE_POSITIVE'
  | 'TIER1_ACKNOWLEDGED'
  | 'TIER1_DEFERRED'
  // ── Tier 2 (Discrepancy / non-adherence) ──
  | 'TIER2_REVIEWED_NO_ACTION'
  | 'TIER2_WILL_CONTACT'
  | 'TIER2_CHANGE_ORDERED'
  | 'TIER2_PHARMACY_RECONCILE'
  | 'TIER2_DEFERRED'
  // ── BP Level 2 (Emergency) ──
  | 'BP_L2_CONTACTED_MED_ADJUSTED'
  | 'BP_L2_CONTACTED_ADVISED_ED'
  | 'BP_L2_CONTACTED_RECHECK'
  | 'BP_L2_SEEN_IN_OFFICE'
  | 'BP_L2_REVIEWED_TRENDING_DOWN'
  | 'BP_L2_UNABLE_TO_REACH_RETRY'

export type ResolutionTier = 'TIER_1' | 'TIER_2' | 'BP_LEVEL_2'

export interface ResolutionActionDef {
  tier: ResolutionTier
  label: string
  /**
   * When true, the `resolutionRationale` free-text is required at the POST
   * /admin/alerts/:id/resolve endpoint. Every Tier 1 + BP Level 2 action
   * requires rationale per spec; only Tier 2's "no action" outlier does in
   * Tier 2.
   */
  requiresRationale: boolean
  /**
   * BP L2 #6 only. When the admin picks this action the resolution endpoint
   * leaves the alert status OPEN and schedules a fresh T+4h EscalationEvent
   * with `triggeredByResolution=true` so the cron dispatches primary + backup
   * again at the retry time.
   */
  triggersBpL2Retry?: boolean
}

export const RESOLUTION_CATALOG: Record<ResolutionAction, ResolutionActionDef> =
  {
    // ── Tier 1 ────────────────────────────────────────────────────────────
    TIER1_DISCONTINUED: {
      tier: 'TIER_1',
      label: 'Confirmed — medication discontinued / will contact patient',
      requiresRationale: true,
    },
    TIER1_CHANGE_ORDERED: {
      tier: 'TIER_1',
      label: 'Confirmed — medication change ordered',
      requiresRationale: true,
    },
    TIER1_FALSE_POSITIVE: {
      tier: 'TIER_1',
      label: 'False positive — patient is not [condition] / medication incorrect',
      requiresRationale: true,
    },
    TIER1_ACKNOWLEDGED: {
      tier: 'TIER_1',
      label: 'Acknowledged — provider aware, clinical rationale documented',
      requiresRationale: true,
    },
    TIER1_DEFERRED: {
      tier: 'TIER_1',
      label: 'Deferred to in-person visit',
      requiresRationale: true,
    },

    // ── Tier 2 ────────────────────────────────────────────────────────────
    TIER2_REVIEWED_NO_ACTION: {
      tier: 'TIER_2',
      label: 'Reviewed — no action needed',
      requiresRationale: true,
    },
    TIER2_WILL_CONTACT: {
      tier: 'TIER_2',
      label: 'Will contact patient to discuss',
      requiresRationale: false,
    },
    TIER2_CHANGE_ORDERED: {
      tier: 'TIER_2',
      label: 'Medication change ordered',
      requiresRationale: false,
    },
    TIER2_PHARMACY_RECONCILE: {
      tier: 'TIER_2',
      label: 'Referred to pharmacy for reconciliation',
      requiresRationale: false,
    },
    TIER2_DEFERRED: {
      tier: 'TIER_2',
      label: 'Deferred to next scheduled visit',
      requiresRationale: false,
    },

    // ── BP Level 2 ────────────────────────────────────────────────────────
    BP_L2_CONTACTED_MED_ADJUSTED: {
      tier: 'BP_LEVEL_2',
      label: 'Patient contacted — medication adjusted',
      requiresRationale: true,
    },
    BP_L2_CONTACTED_ADVISED_ED: {
      tier: 'BP_LEVEL_2',
      label: 'Patient contacted — advised to go to ED',
      requiresRationale: true,
    },
    BP_L2_CONTACTED_RECHECK: {
      tier: 'BP_LEVEL_2',
      label: 'Patient contacted — BP re-check requested',
      requiresRationale: true,
    },
    BP_L2_SEEN_IN_OFFICE: {
      tier: 'BP_LEVEL_2',
      label: 'Patient seen in office — management updated',
      requiresRationale: true,
    },
    BP_L2_REVIEWED_TRENDING_DOWN: {
      tier: 'BP_LEVEL_2',
      label: 'Reviewed — BP trending down, no immediate action',
      requiresRationale: true,
    },
    BP_L2_UNABLE_TO_REACH_RETRY: {
      tier: 'BP_LEVEL_2',
      label: 'Unable to reach patient — will retry',
      requiresRationale: true,
      triggersBpL2Retry: true,
    },
  }

export const ALL_RESOLUTION_ACTIONS = Object.keys(
  RESOLUTION_CATALOG,
) as ResolutionAction[]

/** Maps the alert's AlertTier to the set of valid ResolutionActions. */
export function resolutionActionsForTier(tier: string | null): ResolutionAction[] {
  const group: ResolutionTier | null = (() => {
    switch (tier) {
      case 'TIER_1_CONTRAINDICATION':
        return 'TIER_1'
      case 'TIER_2_DISCREPANCY':
        return 'TIER_2'
      case 'BP_LEVEL_2':
      case 'BP_LEVEL_2_SYMPTOM_OVERRIDE':
        return 'BP_LEVEL_2'
      default:
        return null
    }
  })()
  if (!group) return []
  return ALL_RESOLUTION_ACTIONS.filter((a) => RESOLUTION_CATALOG[a].tier === group)
}
