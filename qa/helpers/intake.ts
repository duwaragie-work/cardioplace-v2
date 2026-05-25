import type { APIRequestContext } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Bulk-fill clinical intake via API. The intake UI itself is exercised by
 * the dedicated intake spec — these helpers exist so non-intake specs can
 * skip past the wizard and land on the post-intake state in one call.
 */

export type IntakeProfile = {
  gender: 'MALE' | 'FEMALE' | 'OTHER'
  heightCm: number
  isPregnant?: boolean
  pregnancyDueDate?: string
  historyPreeclampsia?: boolean
  hasHeartFailure?: boolean
  heartFailureType?: 'HFREF' | 'HFPEF' | 'UNKNOWN' | 'NOT_APPLICABLE'
  hasCAD?: boolean
  hasHCM?: boolean
  hasDCM?: boolean
  hasAorticStenosis?: boolean
  hasAFib?: boolean
  hasTachycardia?: boolean
  hasBradycardia?: boolean
  diagnosedHypertension?: boolean
}

export type IntakeMedication = {
  drugName: string
  drugClass:
    | 'ACE_INHIBITOR'
    | 'ARB'
    | 'BETA_BLOCKER'
    | 'DHP_CCB'
    | 'NDHP_CCB'
    | 'STATIN'
    | 'ANTICOAGULANT'
    | 'LOOP_DIURETIC'
    | 'NITRATE'
    | 'OTHER_UNVERIFIED'
  frequency: 'ONCE_DAILY' | 'TWICE_DAILY' | 'THREE_TIMES_DAILY' | 'NOT_SURE'
}

export async function postIntakeProfile(
  api: APIRequestContext,
  profile: IntakeProfile,
): Promise<void> {
  const res = await api.post('intake/profile', { data: profile })
  expect(res.ok(), `intake/profile: ${await res.text()}`).toBeTruthy()
}

export async function postIntakeMedications(
  api: APIRequestContext,
  medications: IntakeMedication[],
): Promise<void> {
  const res = await api.post('intake/medications', { data: { medications } })
  expect(res.ok(), `intake/medications: ${await res.text()}`).toBeTruthy()
}

/** One call: profile + medications. Used by the "skip-intake" path in non-intake specs. */
export async function bulkIntake(
  api: APIRequestContext,
  profile: IntakeProfile,
  medications: IntakeMedication[] = [],
): Promise<void> {
  await postIntakeProfile(api, profile)
  if (medications.length > 0) {
    await postIntakeMedications(api, medications)
  }
}
