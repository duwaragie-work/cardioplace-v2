// Patient-facing labels for admin-side ResolutionAction values.
//
// Mirrors backend/src/daily_journal/escalation/resolution-actions.ts. The
// admin-facing labels there read like provider notes ("Patient contacted —
// medication adjusted"); these are second-person rewordings safe to render
// on the patient alert detail page.
//
// TODO(Dr. Singal): patient-facing wording per resolution action — pending
// clinical sign-off. Strings below are short, factual paraphrases of the
// already-signed admin catalog and add no new clinical claims.

export type ResolutionAction =
  | 'TIER1_DISCONTINUED'
  | 'TIER1_CHANGE_ORDERED'
  | 'TIER1_FALSE_POSITIVE'
  | 'TIER1_ACKNOWLEDGED'
  | 'TIER1_DEFERRED'
  | 'TIER2_REVIEWED_NO_ACTION'
  | 'TIER2_WILL_CONTACT'
  | 'TIER2_CHANGE_ORDERED'
  | 'TIER2_PHARMACY_RECONCILE'
  | 'TIER2_DEFERRED'
  | 'BP_L2_CONTACTED_MED_ADJUSTED'
  | 'BP_L2_CONTACTED_ADVISED_ED'
  | 'BP_L2_CONTACTED_RECHECK'
  | 'BP_L2_SEEN_IN_OFFICE'
  | 'BP_L2_REVIEWED_TRENDING_DOWN'
  | 'BP_L2_UNABLE_TO_REACH_RETRY'

export const RESOLUTION_PATIENT_LABELS: Record<ResolutionAction, string> = {
  TIER1_DISCONTINUED:
    'Medication discontinued — your care team will contact you.',
  TIER1_CHANGE_ORDERED: 'A medication change has been ordered.',
  TIER1_FALSE_POSITIVE: 'Reviewed — no concern.',
  TIER1_ACKNOWLEDGED: 'Acknowledged by your provider.',
  TIER1_DEFERRED: 'Will be reviewed at your next in-person visit.',

  TIER2_REVIEWED_NO_ACTION: 'Reviewed — no action needed.',
  TIER2_WILL_CONTACT: 'Your care team will contact you to discuss.',
  TIER2_CHANGE_ORDERED: 'A medication change has been ordered.',
  TIER2_PHARMACY_RECONCILE: 'Referred to your pharmacy.',
  TIER2_DEFERRED: 'Will be reviewed at your next scheduled visit.',

  BP_L2_CONTACTED_MED_ADJUSTED: 'Your care team adjusted your medication.',
  BP_L2_CONTACTED_ADVISED_ED:
    'Your care team advised you to go to the emergency department.',
  BP_L2_CONTACTED_RECHECK:
    'Your care team requested a blood-pressure re-check.',
  BP_L2_SEEN_IN_OFFICE:
    'You were seen in office and your management was updated.',
  BP_L2_REVIEWED_TRENDING_DOWN:
    'Reviewed — your blood pressure is trending down.',
  BP_L2_UNABLE_TO_REACH_RETRY:
    'Your care team has been trying to reach you — please answer when they call.',
}

export function patientLabelForResolutionAction(
  action: string | null | undefined,
): string | null {
  if (!action) return null
  return (
    RESOLUTION_PATIENT_LABELS[action as ResolutionAction] ?? null
  )
}
