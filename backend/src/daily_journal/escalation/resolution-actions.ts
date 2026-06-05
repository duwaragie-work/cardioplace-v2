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
  // ── Tier 1 Angioedema (airway emergency, Manisha 5/24 Q4) ──
  // Bespoke 6-option set with conditional sub-fields + transactional
  // side-effects (auto-discontinue ACE/ARB, permanent contraindication flag,
  // targeted MD escalation, compressed re-escalation).
  | 'ANGIO_ADVISED_ED'
  | 'ANGIO_CONFIRMED_ED'
  | 'ANGIO_ACE_DISCONTINUED'
  | 'ANGIO_SEEN_IN_OFFICE'
  | 'ANGIO_FALSE_ALARM'
  | 'ANGIO_UNABLE_TO_REACH'

export type ResolutionTier = 'TIER_1' | 'TIER_2' | 'BP_LEVEL_2' | 'TIER_1_ANGIOEDEMA'

/**
 * A conditional sub-field rendered under an angioedema resolution action and
 * persisted into DeviationAlert.resolutionDetails (Manisha 5/24 Q4). `yesno`
 * fields gate downstream behavior (e.g. willGo=NO → MD escalation); `text`
 * fields capture free-text context (facility, replacement med, cause).
 */
export interface ResolutionSubField {
  key: string
  label: string
  kind: 'yesno' | 'text'
  required: boolean
}

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
  /** Conditional sub-fields persisted into DeviationAlert.resolutionDetails. */
  subFields?: ResolutionSubField[]
  /**
   * Angioedema #3 — discontinue the patient's active ACE_INHIBITOR + ARB
   * PatientMedications (set discontinuedAt) AND stamp the permanent
   * PatientProfile.aceContraindicatedAt flag inside the resolve transaction.
   */
  discontinuesAceArb?: boolean
  /**
   * Angioedema #6 — leave the alert OPEN so the existing compressed angioedema
   * ladder (T0/T15M/T1H/T4H) keeps escalating; record the action for audit.
   */
  leavesAlertOpen?: boolean
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

    // ── Tier 1 Angioedema (Manisha 5/24 Q4) ───────────────────────────────
    ANGIO_ADVISED_ED: {
      tier: 'TIER_1_ANGIOEDEMA',
      label: 'Advised patient to call 911 / go to the ED',
      requiresRationale: true,
      subFields: [
        { key: 'willGo', label: 'Patient agreed to go to the ED', kind: 'yesno', required: true },
      ],
    },
    ANGIO_CONFIRMED_ED: {
      tier: 'TIER_1_ANGIOEDEMA',
      label: 'Confirmed patient is being evaluated in the ED',
      requiresRationale: true,
      subFields: [
        { key: 'facility', label: 'Facility / ED name', kind: 'text', required: true },
      ],
    },
    ANGIO_ACE_DISCONTINUED: {
      tier: 'TIER_1_ANGIOEDEMA',
      label: 'ACE inhibitor / ARB discontinued',
      requiresRationale: true,
      discontinuesAceArb: true,
      subFields: [
        { key: 'replacementOrdered', label: 'Replacement therapy ordered', kind: 'yesno', required: true },
        { key: 'replacementMed', label: 'Replacement medication (if ordered)', kind: 'text', required: false },
      ],
    },
    ANGIO_SEEN_IN_OFFICE: {
      tier: 'TIER_1_ANGIOEDEMA',
      label: 'Patient seen in office',
      requiresRationale: true,
      subFields: [
        { key: 'outcome', label: 'Office visit outcome', kind: 'text', required: true },
      ],
    },
    ANGIO_FALSE_ALARM: {
      tier: 'TIER_1_ANGIOEDEMA',
      label: 'False alarm — not angioedema',
      requiresRationale: true,
      subFields: [
        { key: 'actualCause', label: 'Actual cause of symptoms', kind: 'text', required: true },
      ],
    },
    ANGIO_UNABLE_TO_REACH: {
      tier: 'TIER_1_ANGIOEDEMA',
      label: 'Unable to reach patient — continue escalation',
      requiresRationale: true,
      leavesAlertOpen: true,
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
      // Manisha 5/24 Q4 — angioedema now has its own bespoke 6-option catalog.
      case 'TIER_1_ANGIOEDEMA':
        return 'TIER_1_ANGIOEDEMA'
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

/**
 * Validates the submitted resolutionDetails against an action's required
 * sub-fields (Manisha 5/24 Q4 angioedema actions). Returns the list of missing
 * required sub-field keys — empty means valid. `yesno` fields accept boolean or
 * the 'YES'/'NO' strings the admin modal sends.
 */
export function missingRequiredSubFields(
  action: ResolutionAction,
  details: Record<string, unknown> | undefined | null,
): string[] {
  const def = RESOLUTION_CATALOG[action]
  if (!def.subFields) return []
  const d = details ?? {}
  return def.subFields
    .filter((f) => f.required)
    .filter((f) => {
      const v = d[f.key]
      if (f.kind === 'yesno') {
        return v !== true && v !== false && v !== 'YES' && v !== 'NO'
      }
      return typeof v !== 'string' || v.trim().length === 0
    })
    .map((f) => f.key)
}

/** True when an angioedema "advised ED" resolution recorded the patient
 * declining to go — drives the targeted Medical Director escalation. */
export function angioedemaPatientDeclinedEd(
  action: ResolutionAction,
  details: Record<string, unknown> | undefined | null,
): boolean {
  if (action !== 'ANGIO_ADVISED_ED') return false
  const v = (details ?? {}).willGo
  return v === false || v === 'NO'
}
