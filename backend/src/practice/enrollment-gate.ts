import type { PrismaClient } from '../generated/prisma/client.js'

type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

export type EnrollmentGateReason =
  | 'no-assignment'
  | 'practice-missing-business-hours'
  | 'patient-profile-missing'
  | 'threshold-required-for-condition'

export type EnrollmentGateResult =
  | { ok: true }
  | { ok: false; reasons: EnrollmentGateReason[] }

/**
 * Checks whether a patient user meets every prerequisite to flip
 * `onboardingStatus` → `COMPLETED`.
 *
 * Rationale per CLINICAL_SPEC V2-D "Practice-level configuration — required
 * before enrollment" + §4.2 (HFrEF) / §4.7 (HCM) / §4.8 (DCM) "MANDATORY: do
 * not enroll without provider-configured thresholds."
 *
 * HFpEF (§4.9) is recommended-but-not-mandatory — intentionally not gated.
 */
export async function canCompleteOnboarding(
  prisma: PrismaTx,
  userId: string,
): Promise<EnrollmentGateResult> {
  const reasons: EnrollmentGateReason[] = []

  const [assignment, profile, threshold] = await Promise.all([
    prisma.patientProviderAssignment.findUnique({
      where: { userId },
      include: { practice: true },
    }),
    prisma.patientProfile.findUnique({ where: { userId } }),
    prisma.patientThreshold.findUnique({ where: { userId } }),
  ])

  if (!assignment) {
    reasons.push('no-assignment')
  } else {
    const p = assignment.practice
    if (!p?.businessHoursStart || !p?.businessHoursEnd || !p?.businessHoursTimezone) {
      reasons.push('practice-missing-business-hours')
    }
  }

  if (!profile) {
    reasons.push('patient-profile-missing')
  } else {
    const requiresThreshold =
      profile.heartFailureType === 'HFREF' ||
      profile.hasHCM ||
      profile.hasDCM
    if (requiresThreshold && !threshold) {
      reasons.push('threshold-required-for-condition')
    }
  }

  return reasons.length ? { ok: false, reasons } : { ok: true }
}
