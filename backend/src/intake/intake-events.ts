/**
 * Intake-domain event constants for cross-module fan-out via EventEmitter2.
 *
 * Subscribers (decoupled — no module-level import dependency on IntakeModule):
 *   • ChatService.onIntakeUpdated → drops contextCache entry
 *   • VoiceService.onIntakeUpdated → drops contextCache entry
 *
 * Keeps IntakeService free of ChatModule/VoiceModule references and avoids
 * the ChatModule → IntakeModule → ChatModule circular import.
 */
export const INTAKE_EVENTS = {
  /** Fired after a successful PatientProfile / PatientMedication mutation. */
  UPDATED: 'intake.updated',
} as const

export interface IntakeUpdatedPayload {
  userId: string
}
