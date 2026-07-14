export interface JournalEntryCreatedEvent {
  userId: string
  entryId: string
  measuredAt: Date
  systolicBP: number | null
  diastolicBP: number | null
  pulse: number | null
  weight: number | null
  sessionId: string | null
}

/**
 * Gap 1 fix (2026-07-13) — fires from AlertEngineService.handleEntryCreated
 * AFTER evaluate() resolves. Extends the ENTRY_CREATED payload with the
 * engine's per-entry alert verdict so the N7 "Logged ✓" listener can decide
 * whether to append "Looking good — keep it up!" without racing the engine.
 *
 * `alertsFired === true` when evaluate() persisted ≥1 DeviationAlert row for
 * this entry. Assumed `true` on evaluate() failure so a positive confirmation
 * is never appended to a reading whose clinical status is unknown.
 */
export interface JournalEntryEvaluatedEvent extends JournalEntryCreatedEvent {
  alertsFired: boolean
  alertCount: number
}

export interface JournalEntryUpdatedEvent {
  userId: string
  entryId: string
  measuredAt: Date
  systolicBP: number | null
  diastolicBP: number | null
  pulse: number | null
  weight: number | null
  sessionId: string | null
}

export interface DeviationDetectedEvent {
  userId: string
  entryId: string
  measuredAt: Date
  alertId: string
  type: string
  severity: string
}

/**
 * Emitted by AlertEngineService after persisting a DeviationAlert row. The
 * escalation service listens on this event to route the alert into the
 * appropriate ladder (Tier 1 / BP Level 2 / Tier 2). Renamed from v1
 * `AnomalyTrackedEvent` in phase/7.
 */
export interface AlertCreatedEvent {
  userId: string
  alertId: string
  type: string
  severity: string
  escalated: boolean
  tier: string | null
  ruleId: string | null
}

/**
 * Emitted by EscalationService at each ladder step dispatch (phase/7). Lets
 * downstream consumers (phase/19 monthly analytics, future dashboards) observe
 * the ladder without reaching into EscalationEvent rows directly.
 */
export interface EscalationDispatchedEvent {
  alertId: string
  escalationEventId: string
  userId: string
  alertTier: string
  ruleId: string | null
  ladderStep:
    | 'T0'
    // Cluster 8 — angioedema compressed ladder rungs.
    | 'T15M'
    | 'T1H'
    | 'T2H'
    | 'T4H'
    | 'T8H'
    | 'T24H'
    | 'T48H'
    // Phase/23 — BP Level 1 ladder steps.
    | 'T72H'
    | 'T7D'
    | 'TIER2_48H'
    | 'TIER2_7D'
    | 'TIER2_14D'
  recipientIds: string[]
  recipientRoles: string[]
  channels: ('PUSH' | 'EMAIL' | 'DASHBOARD' | 'PHONE')[]
  afterHours: boolean
  dispatchedAt: Date
  triggeredByResolution: boolean
}

// Phase/7 — `EscalationCreatedEvent` removed. The v1 flow
// (EscalationService.create → JournalNotificationService.handleEscalation) is
// gone; EscalationService now owns notification dispatch inline and emits the
// more granular `EscalationDispatchedEvent` above instead.
