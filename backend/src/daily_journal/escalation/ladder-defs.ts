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
  | 'T2H'
  | 'T4H'
  | 'T8H'
  | 'T24H'
  | 'T48H'
  | 'TIER2_48H'
  | 'TIER2_7D'
  | 'TIER2_14D'

export type RecipientRole =
  | 'PATIENT'
  | 'PRIMARY_PROVIDER'
  | 'BACKUP_PROVIDER'
  | 'MEDICAL_DIRECTOR'
  | 'HEALPLACE_OPS'

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

export type LadderKind = 'TIER_1' | 'TIER_2' | 'BP_LEVEL_2'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// ─── Tier 1 — contraindications + non-BP safety-critical ──────────────────
// Source: CLINICAL_SPEC §V2-D "Tier 1 escalation" table.
// T+0 primary + email; T+4h backup push; T+8h medical director (animated
// red banner); T+24h Healplace ops; T+48h formal incident report.
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
    step: 'T4H',
    offsetMs: 4 * HOUR,
    recipientRoles: ['BACKUP_PROVIDER'],
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

/** Tier 1 T+0 always dual-fires: primary (ladder) + backup (special rule). */
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
// T+0 primary + backup + patient (dual-notify); T+2h medical director;
// T+4h Healplace ops → phone contact. Fires regardless of hours.
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

// ─── Tier router ──────────────────────────────────────────────────────────

/**
 * Resolves the ladder for a given alert tier. Tier 3 + BP Level 1 (both
 * high/low) are not escalated — the caller should treat null as "no ladder".
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
    case 'TIER_2_DISCREPANCY':
      return { kind: 'TIER_2', steps: TIER_2_LADDER }
    case 'BP_LEVEL_2':
    case 'BP_LEVEL_2_SYMPTOM_OVERRIDE':
      return { kind: 'BP_LEVEL_2', steps: BP_LEVEL_2_LADDER }
    // TIER_3_INFO, BP_LEVEL_1_HIGH, BP_LEVEL_1_LOW → no ladder.
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
