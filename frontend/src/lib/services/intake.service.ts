import type {
  IntakeProfilePayload,
  IntakeMedicationsPayload,
  PregnancyPayload,
  UpdateMedicationPayload,
} from '@cardioplace/shared';
import { fetchWithAuth } from './token';

const API = process.env.NEXT_PUBLIC_API_URL;

// Shape returned by GET /me/profile — mirrors PatientProfile in the schema
// (subset that the patient app actually consumes).
export interface PatientProfileDto {
  id: string;
  userId: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | null;
  heightCm?: number | null;
  isPregnant?: boolean;
  pregnancyDueDate?: string | null;
  historyPreeclampsia?: boolean;
  hasHeartFailure?: boolean;
  heartFailureType?: 'HFREF' | 'HFPEF' | 'UNKNOWN' | 'NOT_APPLICABLE';
  hasAFib?: boolean;
  hasCAD?: boolean;
  hasHCM?: boolean;
  hasDCM?: boolean;
  diagnosedHypertension?: boolean;
  profileVerificationStatus?: 'UNVERIFIED' | 'VERIFIED' | 'CORRECTED';
  profileVerifiedAt?: string | null;
  profileVerifiedBy?: string | null;
  profileLastEditedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PatientMedicationDto {
  id: string;
  userId: string;
  drugName: string;
  drugClass: string;
  isCombination: boolean;
  combinationComponents: string[];
  frequency: 'ONCE_DAILY' | 'TWICE_DAILY' | 'THREE_TIMES_DAILY' | 'UNSURE';
  source: 'PATIENT_SELF_REPORT' | 'PROVIDER_ENTERED' | 'PATIENT_VOICE' | 'PATIENT_PHOTO';
  verificationStatus: 'UNVERIFIED' | 'VERIFIED' | 'REJECTED' | 'AWAITING_PROVIDER';
  reportedAt: string;
  discontinuedAt?: string | null;
  rawInputText?: string | null;
  notes?: string | null;
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Request failed: ${res.status}`);
  }
  const json = await res.json();
  return (json.data ?? json) as T;
}

// ── POST /intake/profile (also used as upsert for edits) ────────────────────
export async function saveIntakeProfile(
  payload: IntakeProfilePayload,
): Promise<PatientProfileDto> {
  const res = await fetchWithAuth(`${API}/api/intake/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return unwrap<PatientProfileDto>(res);
}

// ── GET /me/profile (returns null when no profile exists yet) ───────────────
export async function getMyPatientProfile(): Promise<PatientProfileDto | null> {
  const res = await fetchWithAuth(`${API}/api/me/profile`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Request failed: ${res.status}`);
  }
  const json = await res.json();
  return (json.data ?? null) as PatientProfileDto | null;
}

// ── POST /intake/medications (batch create) ─────────────────────────────────
export async function saveIntakeMedications(
  payload: IntakeMedicationsPayload,
): Promise<PatientMedicationDto[]> {
  const res = await fetchWithAuth(`${API}/api/intake/medications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return unwrap<PatientMedicationDto[]>(res);
}

// ── GET /me/medications ─────────────────────────────────────────────────────
export async function getMyMedications(
  includeDiscontinued = false,
): Promise<PatientMedicationDto[]> {
  const qs = includeDiscontinued ? '?includeDiscontinued=true' : '';
  const res = await fetchWithAuth(`${API}/api/me/medications${qs}`);
  return unwrap<PatientMedicationDto[]>(res);
}

// ── PATCH /me/medications/:id ───────────────────────────────────────────────
export async function updateMyMedication(
  id: string,
  payload: UpdateMedicationPayload,
): Promise<PatientMedicationDto> {
  const res = await fetchWithAuth(`${API}/api/me/medications/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return unwrap<PatientMedicationDto>(res);
}

// ── POST /me/pregnancy ──────────────────────────────────────────────────────
export async function updateMyPregnancy(
  payload: PregnancyPayload,
): Promise<PatientProfileDto> {
  const res = await fetchWithAuth(`${API}/api/me/pregnancy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return unwrap<PatientProfileDto>(res);
}
