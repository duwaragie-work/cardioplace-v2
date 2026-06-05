import {
  DrugClass,
  MedicationHoldReason,
  MedicationVerificationStatus,
  Prisma,
  VerificationChangeType,
  VerifierRole,
} from '../generated/prisma/client.js'
import type { PrismaClient } from '../generated/prisma/client.js'

/**
 * #84 (F13 follow-up) — retro-upgrade existing ACE inhibitor / ARB medications
 * when a patient's permanent angioedema contraindication flag
 * (`PatientProfile.aceContraindicatedAt`) is set.
 *
 * F13 (Sprint 1) added the intake-warning modal that forces a *newly re-added*
 * ACE/ARB into provider review. It did NOT touch rows that already existed when
 * the flag flipped — those stay on benign administrative holds (AWAITING_RECORDS,
 * UNCLEAR_NAME, …) whose patient-facing message reads "keep taking it as usual",
 * which is dangerous for an angioedema-contraindicated patient. This sweep closes
 * that gap by forcing every live ACE/ARB to PROVIDER_DIRECTED_HOLD ("do not take"):
 *
 *   • HOLD on an administrative reason  → holdReason = PROVIDER_DIRECTED_HOLD
 *   • VERIFIED (still live)             → verificationStatus = HOLD,
 *                                         holdReason = PROVIDER_DIRECTED_HOLD
 *
 * Each upgraded row writes a ProfileVerificationLog entry (JCAHO traceability).
 *
 * Idempotent: rows already on PROVIDER_DIRECTED_HOLD are excluded from the
 * candidate set, so a second run upgrades nothing and writes no audit rows.
 *
 * Discontinued rows are left alone — they no longer surface to the patient. The
 * angioedema-resolution path (`alert-resolution.service` Case B) discontinues
 * active ACE/ARB outright, which already satisfies this safety goal; this helper
 * covers the paths that set the flag WITHOUT discontinuing.
 */

// Administrative ("keep taking it") hold reasons whose patient message must be
// flipped to the clinical "do not take" instruction. PROVIDER_DIRECTED_HOLD is
// deliberately excluded so the sweep is idempotent.
const ADMINISTRATIVE_HOLD_REASONS: MedicationHoldReason[] = [
  MedicationHoldReason.AWAITING_RECORDS,
  MedicationHoldReason.UNCLEAR_NAME,
  MedicationHoldReason.UNCLEAR_DOSE,
  MedicationHoldReason.OTHER,
]

/** Subset of the Prisma client this sweep needs — satisfied by an interactive tx. */
type PrismaLike = Pick<PrismaClient, 'patientMedication' | 'profileVerificationLog'>

export interface RetroUpgradeArgs {
  userId: string
  /** Actor user id recorded on the audit row (e.g. resolving provider, or 'SYSTEM'). */
  changedBy: string
  changedByRole: VerifierRole
  /** Audit rationale, e.g. "Angioedema contraindication (alert …)". */
  reason: string
  now?: Date
}

/**
 * Sweep + audit. Returns the number of medications upgraded. Caller owns the
 * transaction so the flag-set and this sweep commit atomically.
 */
export async function retroUpgradeAceArbHoldsForContraindication(
  tx: PrismaLike,
  args: RetroUpgradeArgs,
): Promise<number> {
  const now = args.now ?? new Date()

  const candidates = await tx.patientMedication.findMany({
    where: {
      userId: args.userId,
      drugClass: { in: [DrugClass.ACE_INHIBITOR, DrugClass.ARB] },
      discontinuedAt: null,
      OR: [
        {
          verificationStatus: MedicationVerificationStatus.HOLD,
          holdReason: { in: ADMINISTRATIVE_HOLD_REASONS },
        },
        { verificationStatus: MedicationVerificationStatus.VERIFIED },
      ],
    },
  })

  for (const med of candidates) {
    const wasVerified =
      med.verificationStatus === MedicationVerificationStatus.VERIFIED

    await tx.patientMedication.update({
      where: { id: med.id },
      data: {
        verificationStatus: MedicationVerificationStatus.HOLD,
        holdReason: MedicationHoldReason.PROVIDER_DIRECTED_HOLD,
        // A VERIFIED med transitioning into HOLD anchors a fresh reconciliation
        // ladder; an already-HOLD med keeps its original holdSetAt.
        ...(wasVerified ? { holdSetAt: now, holdEscalationLevel: 0 } : {}),
      },
    })

    await tx.profileVerificationLog.create({
      data: {
        userId: args.userId,
        fieldPath: `medication:${med.id}:holdReason`,
        previousValue: {
          verificationStatus: med.verificationStatus,
          holdReason: med.holdReason,
        } as Prisma.InputJsonValue,
        newValue: {
          verificationStatus: MedicationVerificationStatus.HOLD,
          holdReason: MedicationHoldReason.PROVIDER_DIRECTED_HOLD,
        } as Prisma.InputJsonValue,
        changedBy: args.changedBy,
        changedByRole: args.changedByRole,
        changeType: VerificationChangeType.ADMIN_CORRECT,
        discrepancyFlag: true,
        rationale: args.reason,
      },
    })
  }

  return candidates.length
}
