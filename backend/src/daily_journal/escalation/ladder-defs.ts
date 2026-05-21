// Phase/7 escalation ladder definitions — pure data.
//
// Source: CLINICAL_SPEC §V2-D (Tier 1 / Tier 2 / BP Level 2 ladders). Each
// ladder is an ordered list of steps; EscalationService walks the list when
// the cron scanner advances overdue alerts.
//
// `ladderStep` values map to Prisma's LadderStep enum — migration
// 20260422160119_phase7_escalation_ladder adds T2H; existing T4H is reused
// across Tier 1 and BP Level 2 with different recipients / offsets (ladder
// picks the right one by consulting `alert.tier`).
//
// After-hours behavior (CLINICAL_SPEC §V2-D "After-hours handling"):
//  - QUEUE_UNTIL_BUSINESS_HOURS — queue for next business day. Applied to
//    primary-provider notifications in Tier 1 + all Tier 2 steps.
//  - PUSH_BACKUP_IMMEDIATELY — Tier 1 T+0 backup dispatch fires regardless of
//    hours so someone is paged, but the primary's ladder clock starts at
//    business-hours-open.
//  - FIRE_IMMEDIATELY — BP Level 2 never queues; the emergency must page now.

export type LadderStepId =
  | 'T0'
  // Cluster 8 — angioedema compressed ladder rungs (see TIER_1_ANGIOEDEMA_LADDER).
  | 'T15M'
  | 'T1H'
  | 'T2H'
  | 'T4H'
  | 'T8H'
  | 'T24H'
  | 'T48H'
  // Phase/23 — BP Level 1 ladder steps. Reused across HIGH and LOW.
  | 'T72H'
  | 'T7D'
  | 'TIER2_48H'
  | 'TIER2_7D'
  | 'TIER2_14D'

export type RecipientRole =
  | 'PATIENT'
  | 'PRIMARY_PROVIDER'
  | 'BACKUP_PROVIDER'
  | 'MEDICAL_DIRECTOR'
  | 'HEALPLACE_OPS'
  // Cluster 7 A.6 / Gap 5 — caregiver dispatch (PatientCaregiver relation +
  // consent + email/dashboard/SMS channels). Stays gated behind
  // CAREGIVER_DISPATCH_ENABLED until the capture UI + consent loop is live.
  | 'CAREGIVER'

export type NotificationChannel = 'PUSH' | 'EMAIL' | 'DASHBOARD' | 'PHONE'

export type AfterHoursBehavior =
  | 'FIRE_IMMEDIATELY'
  | 'QUEUE_UNTIL_BUSINESS_HOURS'

export interface LadderStep {
  step: LadderStepId
  /** Milliseconds after the alert's T+0 at which this step fires. */
  offsetMs: number
  /** Who gets notified. */
  recipientRoles: RecipientRole[]
  /** Channels used for this step. */
  channels: NotificationChannel[]
  /**
   * Override: always fire, even on after-hours. Used for BP Level 2 (the
   * emergency must page) and for Tier 1 T+0 backup (someone must see it).
   */
  afterHoursBehavior: AfterHoursBehavior
  /**
   * Display hint on the admin dashboard (phase/11). "RED_BANNER" = top banner;
   * "RED_BANNER_ANIMATED" = same banner but blinking (Tier 1 T+8h onwards).
   */
  displayHint?: 'RED_BANNER' | 'RED_BANNER_ANIMATED' | 'YELLOW_BANNER' | 'BADGE'
}

export type LadderKind = 'TIER_1' | 'TIER_2' | 'BP_LEVEL_1' | 'BP_LEVEL_2'

const MINUTE = 60 * 1000
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// ─── Tier 1 — contraindications + non-BP safety-critical ──────────────────
// Source: CLINICAL_SPEC §V2-D "Tier 1 escalation" table.
// T+0 primary + email; T+4h re-send to primary + notify backup; T+8h medical
// director (animated red banner); T+24h Healplace ops; T+48h formal incident
// report.
export const TIER_1_LADDER: LadderStep[] = [
  {
    step: 'T0',
    offsetMs: 0,
    recipientRoles: ['PRIMARY_PROVIDER'],
    channels: ['PUSH', 'EMAIL', 'DASHBOARD'],
    afterHoursBehavior: 'QUEUE_UNTIL_BUSINESS_HOURS',
    displayHint: 'RED_BANNER',
  },
  {
    // CLINICAL_SPEC §V2-D Tier 1 T+4h: "Re-send push with escalation flag"
    // (primary reminder) + "Simultaneously notify practice-level backup".
    step: 'T4H',
    offsetMs: 4 * HOUR,
    recipientRoles: ['PRIMARY_PROVIDER', 'BACKUP_PROVIDER'],
    channels: ['PUSH'],
    afterHoursBehavior: 'QUEUE_UNTIL_BUSINESS_HOURS',
    displayHint: 'RED_BANNER',
  },
  {
    step: 'T8H',
    offsetMs: 8 * HOUR,
    recipientRoles: ['MEDICAL_DIRECTOR'],
    channels: ['PUSH', 'DASHBOARD'],
    afterHoursBehavior: 'QUEUE_UNTIL_BUSINESS_HOURS',
    displayHint: 'RED_BANNER_ANIMATED',
  },
  {
    step: 'T24H',
    offsetMs: 24 * HOUR,
    recipientRoles: ['HEALPLACE_OPS'],
    channels: ['PUSH', 'PHONE'],
    afterHoursBehavior: 'QUEUE_UNTIL_BUSINESS_HOURS',
    displayHint: 'RED_BANNER_ANIMATED',
  },
  {
    step: 'T48H',
    offsetMs: 48 * HOUR,
    recipientRoles: ['HEALPLACE_OPS'],
    channels: ['DASHBOARD'],
    afterHoursBehavior: 'QUEUE_UNTIL_BUSINESS_HOURS',
    displayHint: 'RED_BANNER_ANIMATED',
  },
]

/**
 * Cluster 8 (Manisha 5/18/26) — ACE-angioedema compressed escalation ladder.
 * Airway obstruction can progress within hours, so this escalates far faster
 * than the standard Tier 1 ladder and NEVER queues for business hours
 * (every step FIRE_IMMEDIATELY):
 *
 *   T+0   primary provider — push + email + dashboard
 *   T+15m backup provider (only if primary hasn't acknowledged — the cron's
 *         advanceOverdueLadders already excludes acknowledged alerts)
 *   T+1h  medical director + Healplace ops — push + dashboard
 *   T+4h  Healplace ops — dashboard (MVP "auto incident report": the
 *         unresolved-airway-emergency flag captured in the 15-field audit
 *         trail; full incident-report artifact deferred)
 *
 * ACCEPTED DEFERRAL (user-confirmed 2026-05, gap audit): the sign-off says
 * "incident report auto-generated" at T+4h. We ship the ops-dashboard
 * escalation as the pilot-safe MVP for the June 1 blocker; a standalone
 * incident-report record + admin surface is intentionally post-pilot scope,
 * not an oversight. The 15-field JCAHO audit trail already records the
 * unresolved-emergency timeline, so no compliance gap.
 *
 * Patient T+0 (full-screen red + 911) + caregiver dispatch are handled
 * separately in EscalationService.fireT0 via ANGIOEDEMA_PATIENT_T0 +
 * dispatchCaregiverNotification (same pattern as BP_LEVEL_1_PATIENT_T0).
 */
export const TIER_1_ANGIOEDEMA_LADDER: LadderStep[] = [
  {
    step: 'T0',
    offsetMs: 0,
    recipientRoles: ['PRIMARY_PROVIDER'],
    channels: ['PUSH', 'EMAIL', 'DASHBOARD'],
    afterHoursBehavior: 'FIRE_IMMEDIATELY',
    displayHint: 'RED_BANNER_ANIMATED',
  },
  {
    step: 'T15M',
    offsetMs: 15 * MINUTE,
    recipientRoles: ['BACKUP_PROVIDER'],
    channels: ['PUSH', 'EMAIL'],
    afterHoursBehavior: 'FIRE_IMMEDIATELY',
    displayHint: 'RED_BANNER_ANIMATED',
  },
  {
    step: 'T1H',
    offsetMs: HOUR,
    recipientRoles: ['MEDICAL_DIRECTOR', 'HEALPLACE_OPS'],
    channels: ['PUSH', 'DASHBOARD'],
    afterHoursBehavior: 'FIRE_IMMEDIATELY',
    displayHint: 'RED_BANNER_ANIMATED',
  },
  {
    step: 'T4H',
    offsetMs: 4 * HOUR,
    recipientRoles: ['HEALPLACE_OPS'],
    channels: ['DASHBOARD'],
    afterHoursBehavior: 'FIRE_IMMEDIATELY',
    displayHint: 'RED_BANNER_ANIMATED',
  },
]

/**
 * Tier 1 T+0 after-hours safety net: dispatch BACKUP_PROVIDER immediately so
 * someone is paged while the primary's ladder is queued for next-business-
 * hours. CLINICAL_SPEC §V2-D After-hours handling: "Tier 1: Queue for first
 * business day. Immediate push to backup. Escalation clock starts next
 * business day."
 *
 * Business-hours semantics: do NOT fire this courtesy row — backup properly
 * enters at the T+4h step. EscalationService.fireT0 gates on afterHours.
 */
export const TIER_1_BACKUP_ON_T0: RecipientRole[] = ['BACKUP_PROVIDER']

// ─── Tier 2 — discrepancies / non-adherence ───────────────────────────────
// Source: CLINICAL_SPEC §V2-D "Tier 2 escalation" table.
// T+0 badge only; T+48h banner + single push; T+7d backup; T+14d compliance.
export const TIER_2_LADDER: LadderStep[] = [
  {
    step: 'T0',
    offsetMs: 0,
    recipientRoles: ['PRIMARY_PROVIDER'],
    channels: ['DASHBOARD'],
    afterHoursBehavior: 'QUEUE_UNTIL_BUSINESS_HOURS',
    displayHint: 'BADGE',
  },
  {
    step: 'TIER2_48H',
    offsetMs: 48 * HOUR,
    recipientRoles: ['PRIMARY_PROVIDER'],
    channels: ['PUSH', 'DASHBOARD'],
    afterHoursBehavior: 'QUEUE_UNTIL_BUSINESS_HOURS',
    displayHint: 'YELLOW_BANNER',
  },
  {
    step: 'TIER2_7D',
    offsetMs: 7 * DAY,
    recipientRoles: ['BACKUP_PROVIDER'],
    channels: ['DASHBOARD'],
    afterHoursBehavior: 'QUEUE_UNTIL_BUSINESS_HOURS',
    displayHint: 'YELLOW_BANNER',
  },
  {
    step: 'TIER2_14D',
    offsetMs: 14 * DAY,
    recipientRoles: ['HEALPLACE_OPS'],
    channels: ['DASHBOARD'],
    afterHoursBehavior: 'QUEUE_UNTIL_BUSINESS_HOURS',
    displayHint: 'YELLOW_BANNER',
  },
]

// ─── BP Level 2 — emergency ────────────────────────────────────────────────
// Source: CLINICAL_SPEC §V2-D "BP Level 2 escalation" table.
// T+0 primary + backup + patient (dual-notify); T+2h medical director
// (and patient only if symptom override — "Have you called 911?"); T+4h
// Healplace ops → phone contact. Fires regardless of hours.
//
// Two ladders because T+2h patient notification is conditional on emergency
// symptoms being reported: absolute-emergency alerts (SBP ≥180 / DBP ≥120
// with no reported symptoms) use BP_LEVEL_2_LADDER; symptom-override alerts
// use BP_LEVEL_2_SYMPTOM_OVERRIDE_LADDER. Route via ladderForTier().
export const BP_LEVEL_2_LADDER: LadderStep[] = [
  {
    step: 'T0',
    offsetMs: 0,
    recipientRoles: ['PRIMARY_PROVIDER', 'BACKUP_PROVIDER', 'PATIENT'],
    channels: ['PUSH', 'EMAIL', 'DASHBOARD'],
    afterHoursBehavior: 'FIRE_IMMEDIATELY',
    displayHint: 'RED_BANNER',
  },
  {
    step: 'T2H',
    offsetMs: 2 * HOUR,
    // No patient follow-up — spec conditions the "Have you called 911?"
    // message on emergency symptoms being present. Absolute-emergency alerts
    // that don't report symptoms escalate to medical director only at T+2h.
    recipientRoles: ['MEDICAL_DIRECTOR'],
    channels: ['PUSH'],
    afterHoursBehavior: 'FIRE_IMMEDIATELY',
    displayHint: 'RED_BANNER_ANIMATED',
  },
  {
    step: 'T4H',
    offsetMs: 4 * HOUR,
    recipientRoles: ['HEALPLACE_OPS'],
    channels: ['PUSH', 'PHONE'],
    afterHoursBehavior: 'FIRE_IMMEDIATELY',
    displayHint: 'RED_BANNER_ANIMATED',
  },
]

/**
 * BP Level 2 with symptom override — patient receives a follow-up at T+2h
 * ("Have you called 911?") because they've already reported target-organ-
 * damage symptoms. T+0 and T+4h identical to BP_LEVEL_2_LADDER.
 */
export const BP_LEVEL_2_SYMPTOM_OVERRIDE_LADDER: LadderStep[] = [
  {
    step: 'T0',
    offsetMs: 0,
    recipientRoles: ['PRIMARY_PROVIDER', 'BACKUP_PROVIDER', 'PATIENT'],
    channels: ['PUSH', 'EMAIL', 'DASHBOARD'],
    afterHoursBehavior: 'FIRE_IMMEDIATELY',
    displayHint: 'RED_BANNER',
  },
  {
    step: 'T2H',
    offsetMs: 2 * HOUR,
    // Patient + director per spec: "If emergency symptoms: second patient
    // message: 'Have you called 911?'"
    recipientRoles: ['MEDICAL_DIRECTOR', 'PATIENT'],
    channels: ['PUSH'],
    afterHoursBehavior: 'FIRE_IMMEDIATELY',
    displayHint: 'RED_BANNER_ANIMATED',
  },
  {
    step: 'T4H',
    offsetMs: 4 * HOUR,
    recipientRoles: ['HEALPLACE_OPS'],
    channels: ['PUSH', 'PHONE'],
    afterHoursBehavior: 'FIRE_IMMEDIATELY',
    displayHint: 'RED_BANNER_ANIMATED',
  },
]

// ─── BP Level 1 — non-emergent stage-2 HTN / hypotension ──────────────────
// Source: CLINICAL_SPEC §1.2 + §3 + §4 (HFrEF/HCM/CAD/Pregnancy lower
// bounds). "Notify provider" — non-emergent but requires provider attention
// within a business day. Same ladder for HIGH and LOW; alert.tier
// disambiguates the message text via the registry.
//
// Cadence vs Tier 1 / BP L2: provider gets EMAIL+DASHBOARD at T+0 (no push,
// not emergent), patient gets PUSH+DASHBOARD at T+0 (informational, fires
// immediately so the patient doesn't have to open the app). T+24h escalates
// the channel (push) to primary + audience (backup); T+72h hands off to the
// medical director; T+7d compliance flag to Healplace ops.
export const BP_LEVEL_1_LADDER: LadderStep[] = [
  {
    step: 'T0',
    offsetMs: 0,
    recipientRoles: ['PRIMARY_PROVIDER'],
    channels: ['EMAIL', 'DASHBOARD'],
    afterHoursBehavior: 'QUEUE_UNTIL_BUSINESS_HOURS',
    displayHint: 'YELLOW_BANNER',
  },
  {
    step: 'T24H',
    offsetMs: 24 * HOUR,
    recipientRoles: ['PRIMARY_PROVIDER', 'BACKUP_PROVIDER'],
    channels: ['PUSH', 'EMAIL', 'DASHBOARD'],
    afterHoursBehavior: 'QUEUE_UNTIL_BUSINESS_HOURS',
    displayHint: 'YELLOW_BANNER',
  },
  {
    step: 'T72H',
    offsetMs: 72 * HOUR,
    recipientRoles: ['MEDICAL_DIRECTOR'],
    channels: ['EMAIL', 'DASHBOARD'],
    afterHoursBehavior: 'QUEUE_UNTIL_BUSINESS_HOURS',
    displayHint: 'YELLOW_BANNER',
  },
  {
    step: 'T7D',
    offsetMs: 7 * DAY,
    recipientRoles: ['HEALPLACE_OPS'],
    channels: ['DASHBOARD'],
    afterHoursBehavior: 'QUEUE_UNTIL_BUSINESS_HOURS',
    displayHint: 'YELLOW_BANNER',
  },
]

/**
 * Patient-facing T+0 row for BP Level 1. Spec mandates out-of-app
 * notification so the patient doesn't have to open the app to learn their
 * BP needs attention. Fires immediately regardless of business hours
 * (informational, not interrupting the provider escalation clock). Wired as
 * a separate dispatch in EscalationService.fireT0 so it doesn't pollute the
 * provider ladder's recipientRoles[0].
 *
 * Web-push transport is not yet wired; the Notification row is written and
 * surfaces in the patient app's in-app inbox until transport ships.
 */
export const BP_LEVEL_1_PATIENT_T0: LadderStep = {
  step: 'T0',
  offsetMs: 0,
  recipientRoles: ['PATIENT'],
  channels: ['PUSH', 'DASHBOARD'],
  afterHoursBehavior: 'FIRE_IMMEDIATELY',
}

/**
 * Cluster 8 — angioedema patient T+0. Fires immediately regardless of hours
 * (airway emergency). The patient app routes TIER_1_ANGIOEDEMA to the
 * full-screen red + 911 treatment; this row writes the PUSH + DASHBOARD
 * Notification carrying the registry patientMessage. Wired as a separate
 * dispatch in EscalationService.fireT0 so it doesn't pollute the provider
 * ladder's recipientRoles[0].
 */
export const ANGIOEDEMA_PATIENT_T0: LadderStep = {
  step: 'T0',
  offsetMs: 0,
  recipientRoles: ['PATIENT'],
  channels: ['PUSH', 'DASHBOARD'],
  afterHoursBehavior: 'FIRE_IMMEDIATELY',
}

// ─── Tier router ──────────────────────────────────────────────────────────

/**
 * Resolves the ladder for a given alert tier. Tier 3 is not escalated — the
 * caller should treat null as "no ladder".
 *
 * Tier values mirror Prisma's AlertTier enum.
 */
export function ladderForTier(tier: string | null): {
  kind: LadderKind
  steps: LadderStep[]
} | null {
  switch (tier) {
    case 'TIER_1_CONTRAINDICATION':
      return { kind: 'TIER_1', steps: TIER_1_LADDER }
    case 'TIER_1_ANGIOEDEMA':
      // Tier-1 kind (inherits non-dismissable + the 15-field audit trail),
      // but the compressed steps + FIRE_IMMEDIATELY behavior come from the
      // angioedema ladder, not the standard one.
      return { kind: 'TIER_1', steps: TIER_1_ANGIOEDEMA_LADDER }
    case 'TIER_2_DISCREPANCY':
      return { kind: 'TIER_2', steps: TIER_2_LADDER }
    case 'BP_LEVEL_1_HIGH':
    case 'BP_LEVEL_1_LOW':
      // Phase/23 — same ladder shape; the registry-resolved patientMessage /
      // physicianMessage already encodes HIGH vs LOW wording.
      return { kind: 'BP_LEVEL_1', steps: BP_LEVEL_1_LADDER }
    case 'BP_LEVEL_2':
      return { kind: 'BP_LEVEL_2', steps: BP_LEVEL_2_LADDER }
    case 'BP_LEVEL_2_SYMPTOM_OVERRIDE':
      return { kind: 'BP_LEVEL_2', steps: BP_LEVEL_2_SYMPTOM_OVERRIDE_LADDER }
    // TIER_3_INFO → no ladder; surface via dashboard/details only.
    default:
      return null
  }
}

/**
 * Given a ladder + the currently-completed step, returns the next step (or
 * null if the ladder is finished). Used by the cron scanner.
 */
export function nextStep(
  ladder: LadderStep[],
  completed: LadderStepId | null,
): LadderStep | null {
  if (completed === null) return ladder[0] ?? null
  const idx = ladder.findIndex((s) => s.step === completed)
  if (idx < 0 || idx >= ladder.length - 1) return null
  return ladder[idx + 1]
}

/** Look up a specific step in a ladder by id. */
export function findStep(
  ladder: LadderStep[],
  step: LadderStepId,
): LadderStep | null {
  return ladder.find((s) => s.step === step) ?? null
}
