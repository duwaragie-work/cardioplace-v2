export interface JournalEntryCreatedEvent {
  userId: string
  entryId: string
  entryDate: Date
  systolicBP: number | null
  diastolicBP: number | null
  weight: number | null
  measurementTime?: string | null
}

export interface JournalEntryUpdatedEvent {
  userId: string
  entryId: string
  entryDate: Date
  systolicBP: number | null
  diastolicBP: number | null
  weight: number | null
  measurementTime?: string | null
}

export interface BaselineComputedEvent {
  userId: string
  entryId: string
  entryDate: Date
  snapshotId: string
  baselineSystolic: number
  baselineDiastolic: number
  baselineWeight: number | null
  systolicBP: number
  diastolicBP: number
  medicationTaken?: boolean | null
}

export interface BaselineUnavailableEvent {
  userId: string
  entryId: string
  entryDate: Date
  systolicBP: number
  diastolicBP: number
  medicationTaken?: boolean | null
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
