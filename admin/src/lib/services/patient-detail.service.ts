// Flow H — patient detail service. Wraps the admin-scoped backend endpoints
// the 5-tab detail screen depends on: profile, medications, alerts, threshold,
// and verification logs. All calls use the existing fetchWithAuth helper.

import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

// ─── Shared types (mirror backend Prisma enums) ─────────────────────────────

export type Gender = 'MALE' | 'FEMALE' | 'OTHER'
export type HeartFailureType = 'HFREF' | 'HFPEF' | 'UNKNOWN' | 'NOT_APPLICABLE'
export type ProfileVerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'CORRECTED'

export interface PatientProfile {
  id: string
  userId: string
  gender: Gender | null
  heightCm: number | null
  isPregnant: boolean
  pregnancyDueDate: string | null
  historyPreeclampsia: boolean
  hasHeartFailure: boolean
  heartFailureType: HeartFailureType
  hasAFib: boolean
  hasCAD: boolean
  hasHCM: boolean
  hasDCM: boolean
  hasTachycardia: boolean
  hasBradycardia: boolean
  diagnosedHypertension: boolean
  profileVerificationStatus: ProfileVerificationStatus
  profileVerifiedAt: string | null
  profileVerifiedBy: string | null
  profileLastEditedAt: string
  createdAt: string
  updatedAt: string
}

export type DrugClass =
  | 'ACE_INHIBITOR'
  | 'ARB'
  | 'BETA_BLOCKER'
  | 'DHP_CCB'
  | 'NDHP_CCB'
  | 'LOOP_DIURETIC'
  | 'THIAZIDE'
  | 'MRA'
  | 'SGLT2'
  | 'ANTICOAGULANT'
  | 'STATIN'
  | 'ANTIARRHYTHMIC'
  | 'VASODILATOR_NITRATE'
  | 'ARNI'
  | 'OTHER_UNVERIFIED'

export type MedicationFrequency =
  | 'ONCE_DAILY'
  | 'TWICE_DAILY'
  | 'THREE_TIMES_DAILY'
  | 'UNSURE'

export type MedicationSource =
  | 'PATIENT_SELF_REPORT'
  | 'PROVIDER_ENTERED'
  | 'PATIENT_VOICE'
  | 'PATIENT_PHOTO'

export type MedicationVerificationStatus =
  | 'UNVERIFIED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'AWAITING_PROVIDER'

export interface PatientMedication {
  id: string
  userId: string
  drugName: string
  drugClass: DrugClass
  isCombination: boolean
  combinationComponents: string[]
  frequency: MedicationFrequency
  source: MedicationSource
  verificationStatus: MedicationVerificationStatus
  verifiedByAdminId: string | null
  verifiedAt: string | null
  reportedAt: string
  discontinuedAt: string | null
  rawInputText: string | null
  notes: string | null
}

export interface PatientThreshold {
  id: string
  userId: string
  sbpUpperTarget: number | null
  sbpLowerTarget: number | null
  dbpUpperTarget: number | null
  dbpLowerTarget: number | null
  hrUpperTarget: number | null
  hrLowerTarget: number | null
  setByProviderId: string
  setAt: string
  replacedAt: string | null
  notes: string | null
}

export interface UpsertThresholdPayload {
  sbpUpperTarget?: number | null
  sbpLowerTarget?: number | null
  dbpUpperTarget?: number | null
  dbpLowerTarget?: number | null
  hrUpperTarget?: number | null
  hrLowerTarget?: number | null
  notes?: string | null
}

export type VerificationChangeType =
  | 'PATIENT_REPORT'
  | 'ADMIN_VERIFY'
  | 'ADMIN_CORRECT'
  | 'ADMIN_REJECT'

export type VerifierRole = 'PATIENT' | 'ADMIN' | 'PROVIDER'

export interface ProfileVerificationLog {
  id: string
  userId: string
  fieldPath: string
  previousValue: unknown
  newValue: unknown
  changedBy: string
  changedByRole: VerifierRole
  changeType: VerificationChangeType
  discrepancyFlag: boolean
  rationale: string | null
  createdAt: string
}

export type NotificationChannel = 'PUSH' | 'EMAIL' | 'PHONE' | 'DASHBOARD'

export interface EscalationNotification {
  id: string
  userId: string
  channel: NotificationChannel
  title: string
  sentAt: string
  readAt: string | null
}

export interface PatientAlertEscalationEvent {
  id: string
  escalationLevel: string
  /** Phase/7 ladder step (T0, T2H, T4H, T8H, T24H, T48H, TIER2_*). */
  ladderStep: string | null
  reason: string | null
  triggeredAt: string
  scheduledFor: string | null
  notificationSentAt: string | null
  notificationChannel: NotificationChannel | null
  recipientIds: string[]
  recipientRoles: string[]
  acknowledgedAt: string | null
  acknowledgedBy: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  afterHours: boolean
  triggeredByResolution: boolean
  notifications: EscalationNotification[]
}

export interface PatientAlert {
  id: string
  type: string | null
  severity: string | null
  tier: string | null
  ruleId: string | null
  mode: string | null
  pulsePressure: number | null
  suboptimalMeasurement: boolean | null
  magnitude: number | null
  baselineValue: number | null
  actualValue: number | null
  patientMessage: string | null
  caregiverMessage: string | null
  physicianMessage: string | null
  dismissible: boolean | null
  escalated: boolean
  status: 'OPEN' | 'RESOLVED'
  resolutionAction: string | null
  resolutionRationale: string | null
  resolvedBy: string | null
  createdAt: string
  acknowledgedAt: string | null
  journalEntry: {
    measuredAt: string | null
    systolicBP: number | null
    diastolicBP: number | null
    /** Weight in kg. Used by the admin patient detail to compute BMI
     *  alongside the BP reading. */
    weight: number | null
  } | null
  escalationEvents: PatientAlertEscalationEvent[]
}

// ─── Generic helper ─────────────────────────────────────────────────────────

async function jsonOrThrow<T>(res: Response, fallbackMsg = 'Request failed'): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `${fallbackMsg}: ${res.status}`)
  }
  const json = await res.json()
  return (json.data ?? json) as T
}

// ─── Profile (H1) ────────────────────────────────────────────────────────────

export async function getPatientProfile(userId: string): Promise<PatientProfile | null> {
  const res = await fetchWithAuth(`${API}/api/admin/users/${userId}/profile`)
  return jsonOrThrow<PatientProfile | null>(res, 'Could not load profile')
}

export async function verifyPatientProfile(
  userId: string,
  rationale?: string,
): Promise<PatientProfile> {
  const res = await fetchWithAuth(`${API}/api/admin/users/${userId}/verify-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rationale }),
  })
  return jsonOrThrow<PatientProfile>(res, 'Could not mark profile verified')
}

export async function correctPatientProfile(
  userId: string,
  corrections: Partial<PatientProfile>,
  rationale: string,
): Promise<PatientProfile> {
  const res = await fetchWithAuth(`${API}/api/admin/users/${userId}/correct-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ corrections, rationale }),
  })
  return jsonOrThrow<PatientProfile>(res, 'Could not save correction')
}

/**
 * Reject a single profile field — flips the whole profile back to UNVERIFIED
 * and writes an ADMIN_REJECT audit row pinned to the field. Used after a
 * prior verify when the admin spots a problem on re-review.
 */
export async function rejectProfileField(
  userId: string,
  field: keyof PatientProfile,
  rationale?: string,
): Promise<PatientProfile> {
  const res = await fetchWithAuth(`${API}/api/admin/users/${userId}/reject-profile-field`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ field, rationale }),
  })
  return jsonOrThrow<PatientProfile>(res, 'Could not reject field')
}

// ─── Medications (H2) ────────────────────────────────────────────────────────

export async function getPatientMedications(userId: string): Promise<PatientMedication[]> {
  const res = await fetchWithAuth(`${API}/api/admin/users/${userId}/medications`)
  return jsonOrThrow<PatientMedication[]>(res, 'Could not load medications')
}

export async function verifyMedication(
  medicationId: string,
  status: 'VERIFIED' | 'REJECTED' | 'AWAITING_PROVIDER',
  rationale?: string,
): Promise<PatientMedication> {
  const res = await fetchWithAuth(`${API}/api/admin/medications/${medicationId}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, rationale }),
  })
  return jsonOrThrow<PatientMedication>(res, 'Could not verify medication')
}

// ─── Alerts (H3) ─────────────────────────────────────────────────────────────

export async function getPatientAlerts(
  userId: string,
  filters: { status?: string; tier?: string } = {},
): Promise<PatientAlert[]> {
  const qs = new URLSearchParams()
  if (filters.status) qs.append('status', filters.status)
  if (filters.tier) qs.append('tier', filters.tier)
  const q = qs.toString()
  const res = await fetchWithAuth(
    `${API}/api/provider/patients/${userId}/alerts${q ? `?${q}` : ''}`,
  )
  return jsonOrThrow<PatientAlert[]>(res, 'Could not load alerts')
}

// ─── Thresholds (H4) ─────────────────────────────────────────────────────────

export async function getPatientThreshold(userId: string): Promise<PatientThreshold | null> {
  const res = await fetchWithAuth(`${API}/api/admin/patients/${userId}/threshold`)
  if (res.status === 404) return null
  return jsonOrThrow<PatientThreshold>(res, 'Could not load threshold')
}

export async function upsertPatientThreshold(
  userId: string,
  body: UpsertThresholdPayload,
  mode: 'create' | 'update',
): Promise<PatientThreshold> {
  const res = await fetchWithAuth(`${API}/api/admin/patients/${userId}/threshold`, {
    method: mode === 'create' ? 'POST' : 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return jsonOrThrow<PatientThreshold>(res, 'Could not save threshold')
}

// ─── Verification logs / Timeline (H5) ──────────────────────────────────────

export async function getVerificationLogs(userId: string): Promise<ProfileVerificationLog[]> {
  const res = await fetchWithAuth(`${API}/api/admin/users/${userId}/verification-logs`)
  return jsonOrThrow<ProfileVerificationLog[]>(res, 'Could not load logs')
}

// ─── Threshold defaults (Flow H4 condition prefills) ────────────────────────

/**
 * Per the Dr. Singal clinical spec:
 *   • CAD                       → DBP lower target = 70
 *   • HFrEF                     → SBP lower target = 85
 *   • HCM                       → SBP lower target = 100
 * Returns the partial threshold to suggest as defaults given a profile.
 */
export function thresholdDefaultsFor(
  profile: Pick<PatientProfile, 'hasCAD' | 'hasHCM' | 'heartFailureType'> | null,
): UpsertThresholdPayload {
  if (!profile) return {}
  const out: UpsertThresholdPayload = {}
  if (profile.hasCAD) out.dbpLowerTarget = 70
  if (profile.heartFailureType === 'HFREF') out.sbpLowerTarget = 85
  if (profile.hasHCM) out.sbpLowerTarget = 100 // HCM trumps HFrEF if both
  return out
}

/** Patients flagged HFrEF / HCM / DCM require an explicit threshold per spec. */
export function thresholdMandatory(
  profile: Pick<PatientProfile, 'hasHCM' | 'hasDCM' | 'heartFailureType'> | null,
): boolean {
  if (!profile) return false
  return profile.hasHCM || profile.hasDCM || profile.heartFailureType === 'HFREF'
}
