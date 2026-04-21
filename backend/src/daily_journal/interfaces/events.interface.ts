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

export interface AnomalyTrackedEvent {
  userId: string
  alertId: string
  type: string
  severity: string
  escalated: boolean
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
