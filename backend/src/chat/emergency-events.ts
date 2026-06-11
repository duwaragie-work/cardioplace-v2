/**
 * Emergency-domain event constants for cross-module fan-out via EventEmitter2.
 *
 * Emitted by:
 *   • ChatService.recordEmergencyEvent — after a successful EmergencyEvent
 *     DB write (triggered by either the flag_emergency tool from chat OR
 *     voice, or by the upstream emergency-detection classifier).
 *
 * Subscribed by:
 *   • EscalationService.onEmergencyFlagged — pages the patient's assigned
 *     provider and consenting caregivers via the existing
 *     dispatchCaregiverNotification machinery (CRITICAL tier).
 *
 * Decoupled so the chat module doesn't have to depend on the daily-journal
 * module just to fan out a notification — same pattern as INTAKE_EVENTS.
 */
export const EMERGENCY_EVENTS = {
  /** Fired after a successful EmergencyEvent row insert. */
  FLAGGED: 'emergency.flagged',
} as const

export interface EmergencyFlaggedPayload {
  userId: string
  sessionId: string | null
  /** Free-text description of what the patient said (used in the care-team page). */
  situation: string
  /** Origin signal — useful for analytics + diagnostic split. */
  source: 'chat-tool' | 'voice-tool' | 'detector'
}
