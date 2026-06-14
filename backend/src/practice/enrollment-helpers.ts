import type { PrismaService } from '../prisma/prisma.service.js'

/**
 * Shared "was this patient ever enrolled?" predicate, used by:
 *   • the three escalation dispatch gates (EscalationService) — a previously-
 *     enrolled patient who was auto-un-enrolled (serious condition added without
 *     a threshold) keeps their full dispatch + ladder; only the personalized
 *     threshold is pending, care team + routing are already in place.
 *   • the admin patient-header serializer (ProviderService.getPatientSummary) —
 *     to drive the "threshold pending" vs "awaiting enrollment" badge.
 *
 * Single source of truth so the two callers can't drift. See
 * enrollment-gate-emergency-gap memory note + Manisha sign-off 2026-06-12.
 */
export async function wasEverEnrolled(
  prisma: PrismaService,
  userId: string,
): Promise<boolean> {
  // Patient was at some point ENROLLED iff at least one ProfileVerificationLog
  // row attests to it — either an audit row WRITING enrollment (newValue=ENROLLED,
  // produced by completeEnrollment / autoReEnrollIfGateCleared) or an audit row
  // REVERTING from enrollment (previousValue=ENROLLED, produced by the two
  // threshold-gap revert paths). Both directions prove the patient was once
  // in the ENROLLED state.
  //
  // This is robust to:
  //   • Seeded patients: their auto-un-enroll on serious-condition-add writes a
  //     row with previousValue=ENROLLED, which this query catches.
  //   • Re-enrolled patients: their re-enroll writes newValue=ENROLLED, caught.
  //   • Future hypothetical "manual un-enroll of never-enrolled patient" paths
  //     would write previousValue=NOT_ENROLLED + newValue=NOT_ENROLLED, neither
  //     of which matches — correctly identified as never-enrolled.
  //
  // See enrollment-gate-emergency-gap memory note + Manisha sign-off 2026-06-12.
  const prior = await prisma.profileVerificationLog.findFirst({
    where: {
      userId,
      fieldPath: 'user.enrollmentStatus',
      OR: [
        { newValue: { equals: 'ENROLLED' } },
        { previousValue: { equals: 'ENROLLED' } },
      ],
    },
    select: { id: true },
  })
  return prior !== null
}
