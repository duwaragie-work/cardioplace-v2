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
    | 'T2H'
    | 'T4H'
    | 'T8H'
    | 'T24H'
    | 'T48H'
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

export interface EscalationCreatedEvent {
  userId: string
  escalationEventId: string
  alertId: string
  escalationLevel: string
  deviationType: string
  reason: string
  symptoms?: string[]
  patientMessage: string
  careTeamMessage: string
}
