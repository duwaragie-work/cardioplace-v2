export interface JournalEntryCreatedEvent {
  userId: string
  entryId: string
  entryDate: Date
  sleepHours: number | null
  sleepQuality: number | null
  awakenings: number | null
}

export interface JournalEntryUpdatedEvent {
  userId: string
  entryId: string
  entryDate: Date
  sleepHours: number | null
  sleepQuality: number | null
  awakenings: number | null
}

export interface BaselineComputedEvent {
  userId: string
  entryId: string
  entryDate: Date
  snapshotId: string
  baselineSleepHours: number
  baselineSleepQuality: number
  baselineAwakenings: number
  sleepHours: number
  sleepQuality: number
  awakenings: number
}

export interface BaselineUnavailableEvent {
  userId: string
  entryId: string
  entryDate: Date
  sleepHours: number
  sleepQuality: number
  awakenings: number
  reason: string
}

export interface DeviationDetectedEvent {
  userId: string
  entryId: string
  entryDate: Date
  alertId: string
  type: string
  severity: string
}

export interface AnomalyTrackedEvent {
  userId: string
  alertId: string
  type: string
  severity: string
  occurrencesInLast3Days: number
  escalated: boolean
}

export interface EscalationCreatedEvent {
  userId: string
  escalationEventId: string
  alertId: string
  escalationLevel: string
  deviationType: string
  reason: string
}
