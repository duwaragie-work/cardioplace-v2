import { matchToCatalog } from '@cardioplace/shared'
import {
  DrugClass,
  MedicationHoldReason,
  MedicationVerificationStatus,
} from '../generated/prisma/client.js'

/**
 * #85 — brand/generic medication dedup by canonical drug identity.
 *
 * Canonical identity reuses the existing shared catalog
 * (`shared/src/medications.ts`) via matchToCatalog(), which resolves a brand
 * OR generic name (exact or "Lisinopril 10mg"-style substring) to the catalog
 * `id` — e.g. both "Cozaar" and "Losartan" → "losartan". We do NOT build a
 * parallel catalog.
 *
 * Fallback: a name that doesn't resolve (new/typo'd/off-catalog drug) yields a
 * NULL canonicalDrugId. That is intentional — dedup (and the 409 add gate) only
 * fire when the canonical resolves, so free-text meds are never blocked or
 * merged. Future-us: the null-canonical path is a deliberate skip, not a bug.
 */
export function resolveCanonicalDrugId(drugName: string | null | undefined): string | null {
  if (!drugName) return null
  return matchToCatalog(drugName)?.catalogId ?? null
}

/**
 * Catalog-authoritative drug class for a name that resolves to the catalog
 * (e.g. "Metoprolol" / "Toprol XL" → BETA_BLOCKER). Returns null for
 * off-catalog names, so callers fall back to the user-provided class. Every
 * catalog `drugClass` (DrugClassInput) is a valid Prisma `DrugClass` member —
 * same string values — so the cast is safe.
 *
 * Used by admin add/edit to prevent a provider mis-classifying a known drug
 * (e.g. picking OTHER_UNVERIFIED for Metoprolol): when the name resolves, the
 * catalog class wins.
 */
export function resolveCanonicalDrugClass(
  drugName: string | null | undefined,
): DrugClass | null {
  if (!drugName) return null
  const match = matchToCatalog(drugName)
  return match ? (match.drugClass as DrugClass) : null
}

/**
 * Most-restrictive-status priority for merging duplicate canonical meds
 * (#85 4e). Higher score wins / is kept. Order (per Duwaragie 2026-06-04):
 *   PROVIDER_DIRECTED_HOLD > admin holds (AWAITING_RECORDS > UNCLEAR_NAME >
 *   UNCLEAR_DOSE > OTHER) > AWAITING_PROVIDER > VERIFIED > UNVERIFIED
 *   (self-report) > REJECTED.
 * A clinical "do not take" hold must never be lost to a VERIFIED brand-name
 * duplicate — the exact Cozaar(HOLD)+Losartan(VERIFIED) angioedema risk #85
 * was filed for.
 */
export function medicationRestrictiveness(med: {
  verificationStatus: MedicationVerificationStatus
  holdReason: MedicationHoldReason | null
}): number {
  if (med.verificationStatus === MedicationVerificationStatus.HOLD) {
    switch (med.holdReason) {
      case MedicationHoldReason.PROVIDER_DIRECTED_HOLD:
        return 100
      case MedicationHoldReason.AWAITING_RECORDS:
        return 90
      case MedicationHoldReason.UNCLEAR_NAME:
        return 80
      case MedicationHoldReason.UNCLEAR_DOSE:
        return 75
      case MedicationHoldReason.OTHER:
        return 70
      default:
        return 65 // HOLD with no reason recorded
    }
  }
  switch (med.verificationStatus) {
    case MedicationVerificationStatus.AWAITING_PROVIDER:
      return 50
    case MedicationVerificationStatus.VERIFIED:
      return 40
    case MedicationVerificationStatus.UNVERIFIED:
      return 20
    case MedicationVerificationStatus.REJECTED:
      return 10
    default:
      return 0
  }
}

/**
 * Pure picker — returns the row to KEEP from a set of canonical duplicates
 * (highest restrictiveness; ties broken by oldest reportedAt so the original
 * record wins). Used by the merge migration logic + unit-tested directly.
 */
export function pickMostRestrictive<
  T extends {
    verificationStatus: MedicationVerificationStatus
    holdReason: MedicationHoldReason | null
    reportedAt: Date
  },
>(rows: T[]): T | null {
  if (rows.length === 0) return null
  return rows.reduce((best, cur) => {
    const a = medicationRestrictiveness(cur)
    const b = medicationRestrictiveness(best)
    if (a > b) return cur
    if (a < b) return best
    return cur.reportedAt < best.reportedAt ? cur : best
  })
}
