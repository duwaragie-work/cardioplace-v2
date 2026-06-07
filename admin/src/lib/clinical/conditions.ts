import type { PatientProfile } from '@/lib/services/patient-detail.service';

/**
 * Human-readable label for the threshold-mandatory cardiac condition(s) a
 * patient carries — used to interpolate the Thresholds-tab mandatory banner.
 *
 * F30: the banner previously joined only HFrEF / HCM / DCM, so an
 * aortic-stenosis-only patient rendered "This patient has  — set ...". We list
 * every mandatory condition (Manisha 5/24 Q5C adds aortic stenosis) and fall
 * back to a generic phrase so the sentence never reads with a dangling gap.
 */
export function patientConditionLabel(
  profile: Pick<
    PatientProfile,
    'heartFailureType' | 'hasHCM' | 'hasDCM' | 'hasAorticStenosis'
  > | null,
): string {
  if (!profile) return 'a monitored condition';
  const labels = [
    profile.heartFailureType === 'HFREF' ? 'HFrEF' : null,
    profile.hasHCM ? 'HCM' : null,
    profile.hasDCM ? 'DCM' : null,
    profile.hasAorticStenosis ? 'aortic stenosis' : null,
  ].filter(Boolean);
  return labels.length ? labels.join(' / ') : 'a monitored condition';
}
