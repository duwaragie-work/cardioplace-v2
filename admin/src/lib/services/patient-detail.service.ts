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
  // From User.dateOfBirth (not PatientProfile). Surfaced in this DTO so the
  // admin profile tab can display age in the Demographics section.
  // Read-only — patients self-edit via clinical-intake A1 or profile edit.
  dateOfBirth: string | null
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
  // Manisha 5/24 Q5C — aortic stenosis (HCM-interim thresholds).
  hasAorticStenosis: boolean
  // Manisha 5/24 Q4 — permanent ACE-inhibitor contraindication set when an
  // angioedema alert is resolved via "ACE/ARB discontinued".
  aceContraindicatedAt: string | null
  aceContraindicationReason: string | null
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
  | 'AS_NEEDED'
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
  | 'HOLD'

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
  /** Resolved display name of the clinician in setByProviderId — falls
   *  back to email when name is missing, or null when the user record is
   *  gone. Surfaced as "Set by …" in the Thresholds tab. */
  setByName: string | null
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
  /** Resolved display name for changedBy — name → email → null. Used by the
   *  Timeline tab so the actor line reads "Dr. Singal" instead of a
   *  truncated UUID. */
  changedByName: string | null
  changedByRole: VerifierRole
  /** The actor's real role resolved from their account (e.g. PROVIDER), since
   *  changedByRole stores a coarse ADMIN for every admin action. Falls back to
   *  changedByRole. Used by the Timeline actor line. */
  changedByRoleResolved: string | null
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
  /** Resolved display name for acknowledgedBy. */
  acknowledgedByName: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  /** Resolved display name for resolvedBy. */
  resolvedByName: string | null
  afterHours: boolean
  triggeredByResolution: boolean
  /** Finding 5 — explicit system-vs-human dispatch attribution. true =
   *  auto-dispatched by the escalation scheduler (cron); false = scheduled
   *  by an admin action (BP_L2 retry). Source of truth for the audit chip. */
  dispatchedBySystem: boolean
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
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
  resolutionAction: string | null
  resolutionRationale: string | null
  /** Alert-level actor who acknowledged (patient on patient-ack, clinician on
   *  provider-ack). Backed by DeviationAlert.acknowledgedByUserId. */
  acknowledgedBy: string | null
  /** Resolved display name for acknowledgedBy — fixes the observed bug where
   *  a patient acknowledgement rendered "Acknowledged" with no name. */
  acknowledgedByName: string | null
  resolvedBy: string | null
  /** Resolved display name for the alert-level resolvedBy — used by the
   *  15-field audit footer in EscalationAuditTrail. */
  resolvedByName: string | null
  createdAt: string
  acknowledgedAt: string | null
  /** Distinct resolution timestamp (DeviationAlert.resolvedAt). The footer
   *  previously showed acknowledgedAt mislabelled as "Resolved". */
  resolvedAt: string | null
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

/**
 * Confirm a single profile field (IVR-08) — writes an ADMIN_VERIFY audit row
 * pinned to `profile.{field}` without flipping the whole-profile status. The
 * Profile tab derives the field's "Confirmed" state from this log row.
 */
export async function confirmProfileField(
  userId: string,
  field: keyof PatientProfile,
  rationale?: string,
): Promise<PatientProfile> {
  const res = await fetchWithAuth(`${API}/api/admin/users/${userId}/confirm-profile-field`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ field, rationale }),
  })
  return jsonOrThrow<PatientProfile>(res, 'Could not confirm field')
}

/**
 * Bulk "Confirm all" (IVR-25) — confirms every supplied field in one call.
 * Already-confirmed fields are skipped server-side (no duplicate audit rows).
 */
export async function confirmProfileFields(
  userId: string,
  fields: (keyof PatientProfile)[],
  rationale?: string,
): Promise<PatientProfile> {
  const res = await fetchWithAuth(`${API}/api/admin/users/${userId}/confirm-profile-fields`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, rationale }),
  })
  return jsonOrThrow<PatientProfile>(res, 'Could not confirm fields')
}

// ─── Medications (H2) ────────────────────────────────────────────────────────

export async function getPatientMedications(userId: string): Promise<PatientMedication[]> {
  const res = await fetchWithAuth(`${API}/api/admin/users/${userId}/medications`)
  return jsonOrThrow<PatientMedication[]>(res, 'Could not load medications')
}

export type MedicationHoldReason =
  | 'AWAITING_RECORDS'
  | 'UNCLEAR_NAME'
  | 'UNCLEAR_DOSE'
  | 'PROVIDER_DIRECTED_HOLD'
  | 'OTHER';

export async function verifyMedication(
  medicationId: string,
  status: 'VERIFIED' | 'REJECTED' | 'AWAITING_PROVIDER' | 'HOLD',
  rationale?: string,
  holdReason?: MedicationHoldReason,
): Promise<PatientMedication> {
  const res = await fetchWithAuth(`${API}/api/admin/medications/${medicationId}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, rationale, holdReason }),
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

/**
 * THR-033 — clear (delete) a patient's personalized threshold. The patient
 * reverts to the standard table; the backend cascades an enrollment revert when
 * the condition still requires a threshold. 404 is treated as already-clear.
 */
export async function deletePatientThreshold(userId: string): Promise<void> {
  const res = await fetchWithAuth(`${API}/api/admin/patients/${userId}/threshold`, {
    method: 'DELETE',
  })
  if (!res.ok && res.status !== 404) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Could not clear threshold: ${res.status}`)
  }
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
 *   • DCM   (managed as HFrEF)  → SBP lower target = 85   (spec §4.8)
 *   • HCM                       → SBP lower target = 100
 * Returns the partial threshold to suggest as defaults given a profile.
 */
export function thresholdDefaultsFor(
  profile: Pick<
    PatientProfile,
    'hasCAD' | 'hasHCM' | 'hasDCM' | 'hasAorticStenosis' | 'heartFailureType'
  > | null,
): UpsertThresholdPayload {
  if (!profile) return {}
  const out: UpsertThresholdPayload = {}
  if (profile.hasCAD) out.dbpLowerTarget = 70
  // THR-016 — DCM is managed as HFrEF (spec §4.8): default lower-bound SBP <85.
  if (profile.heartFailureType === 'HFREF' || profile.hasDCM) out.sbpLowerTarget = 85
  if (profile.hasHCM) out.sbpLowerTarget = 100 // HCM trumps HFrEF/DCM if both
  // Manisha 5/24 Q5C — aortic stenosis shares HCM's interim lower bound (100).
  if (profile.hasAorticStenosis) out.sbpLowerTarget = 100
  return out
}

/** Patients flagged HFrEF / HCM / DCM / aortic stenosis require an explicit
 *  threshold per spec (Manisha 5/24 Q5C adds aortic stenosis). */
export function thresholdMandatory(
  profile: Pick<
    PatientProfile,
    'hasHCM' | 'hasDCM' | 'hasAorticStenosis' | 'heartFailureType'
  > | null,
): boolean {
  if (!profile) return false
  return (
    profile.hasHCM ||
    profile.hasDCM ||
    profile.hasAorticStenosis ||
    profile.heartFailureType === 'HFREF'
  )
}

// ─── Verification-log derivation (IVR-08 / IVR-23 / THR-REVIEW) ──────────────

/** Per-field verification state derived from the latest log at profile.{field}. */
export type FieldVerificationStatus = 'confirmed' | 'corrected' | 'rejected' | 'pending'

const CHANGE_TYPE_TO_STATUS: Record<VerificationChangeType, FieldVerificationStatus> = {
  ADMIN_VERIFY: 'confirmed',
  ADMIN_CORRECT: 'corrected',
  ADMIN_REJECT: 'rejected',
  PATIENT_REPORT: 'pending',
}

/**
 * Latest log per `profile.{field}` fieldPath, keyed by the bare field name.
 * Logs are scanned newest-first so the first hit per field wins.
 */
export function latestProfileFieldLogs(
  logs: ProfileVerificationLog[],
): Map<string, ProfileVerificationLog> {
  const sorted = [...logs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  const out = new Map<string, ProfileVerificationLog>()
  for (const log of sorted) {
    if (!log.fieldPath.startsWith('profile.')) continue
    const field = log.fieldPath.slice('profile.'.length)
    if (field === 'verificationStatus') continue // whole-profile flip, not a field
    if (!out.has(field)) out.set(field, log)
  }
  return out
}

/**
 * Derive each profile field's status from the verification logs (IVR-08):
 * ADMIN_VERIFY→confirmed, ADMIN_CORRECT→corrected, ADMIN_REJECT→rejected,
 * PATIENT_REPORT→pending. Fields with no log default to 'pending'.
 */
export function deriveFieldStatuses(
  logs: ProfileVerificationLog[],
): Map<string, FieldVerificationStatus> {
  const latest = latestProfileFieldLogs(logs)
  const out = new Map<string, FieldVerificationStatus>()
  for (const [field, log] of latest) {
    out.set(field, CHANGE_TYPE_TO_STATUS[log.changeType] ?? 'pending')
  }
  return out
}

/**
 * IVR-23 — count of fields the patient changed since the last admin review.
 * A field "changed since verification" when its latest log is a PATIENT_REPORT
 * that post-dates the most recent admin verify/correct anywhere on the profile.
 * Returns 0 when the profile has never been admin-reviewed (the unverified
 * banner already covers that case).
 */
export function fieldsChangedSinceVerification(
  logs: ProfileVerificationLog[],
): string[] {
  const lastAdminReviewAt = logs
    .filter(
      (l) =>
        l.changeType === 'ADMIN_VERIFY' || l.changeType === 'ADMIN_CORRECT',
    )
    .reduce<number>((max, l) => Math.max(max, new Date(l.createdAt).getTime()), 0)
  if (lastAdminReviewAt === 0) return []

  const changed: string[] = []
  for (const [field, log] of latestProfileFieldLogs(logs)) {
    if (
      log.changeType === 'PATIENT_REPORT' &&
      new Date(log.createdAt).getTime() > lastAdminReviewAt
    ) {
      changed.push(field)
    }
  }
  return changed
}

/**
 * THR-REVIEW — timestamp (ms) of the most recent log that *changed* a
 * threshold-mandatory condition: hasHCM/hasDCM toggled either way, or
 * heartFailureType moving TO or FROM HFREF. Covers both adding and removing a
 * serious condition — both invalidate the existing threshold and require a
 * re-review. Returns null when no such change is recorded.
 */
export function mandatoryConditionChangedAt(
  logs: ProfileVerificationLog[],
): number | null {
  let latest = 0
  for (const log of logs) {
    const changed =
      log.fieldPath === 'profile.hasHCM' ||
      log.fieldPath === 'profile.hasDCM' ||
      // Manisha 5/24 Q5C — aortic stenosis is threshold-mandatory too.
      log.fieldPath === 'profile.hasAorticStenosis' ||
      (log.fieldPath === 'profile.heartFailureType' &&
        (log.newValue === 'HFREF' || log.previousValue === 'HFREF'))
    if (changed) latest = Math.max(latest, new Date(log.createdAt).getTime())
  }
  return latest === 0 ? null : latest
}
