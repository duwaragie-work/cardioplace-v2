// Gap 5 — caregiver contracts shared by backend, patient app, and admin app.
// Enum values mirror the Prisma CaregiverNotifyChannel (patient_caregiver.prisma)
// as a string-literal union so the shared package stays framework-free.

export type CaregiverNotifyChannelInput = 'NONE' | 'DASHBOARD' | 'SMS' | 'EMAIL'

/** Read shape returned by GET caregiver endpoints (patient + admin). */
export interface CaregiverDto {
  id: string
  patientUserId: string
  name: string
  relationship: string | null
  phone: string | null
  email: string | null
  notifyChannel: CaregiverNotifyChannelInput
  /** ISO timestamp; null = consent NOT given → no dispatch. */
  consentGivenAt: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

/** POST body — create a caregiver contact. */
export interface CreateCaregiverPayload {
  name: string
  relationship?: string | null
  phone?: string | null
  email?: string | null
  notifyChannel?: CaregiverNotifyChannelInput
  /** When true, the server stamps consentGivenAt + consentGivenBy. */
  consentGiven?: boolean
}

/** PATCH body — partial update. `consentGiven` toggles the consent stamp. */
export interface UpdateCaregiverPayload {
  name?: string
  relationship?: string | null
  phone?: string | null
  email?: string | null
  notifyChannel?: CaregiverNotifyChannelInput
  consentGiven?: boolean
  active?: boolean
}

/** Channels that actually transmit PHI and therefore require consent. */
export const CAREGIVER_DISPATCH_CHANNELS: readonly CaregiverNotifyChannelInput[] =
  ['DASHBOARD', 'SMS', 'EMAIL']

/** True when this channel is wired for real delivery today (pilot = EMAIL +
 *  DASHBOARD). SMS is captured but not yet deliverable (NoopSmsService). */
export function isCaregiverChannelDeliverable(
  channel: CaregiverNotifyChannelInput,
): boolean {
  return channel === 'EMAIL' || channel === 'DASHBOARD'
}
