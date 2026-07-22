/**
 * Bug 19 — backend unit conversion at the chat/voice tool boundary.
 *
 * Storage contract: `JournalEntry.weight` is `Decimal kg`. The manual BP
 * form converts lbs → kg in the browser before POSTing
 * (frontend/src/lib/units.ts). The chat + voice tool dispatchers, however,
 * accept `weight` as a number described to the LLM as "Weight in lbs" and
 * previously passed it straight to the DTO, persisting the lbs value into
 * the kg column. A patient saying "150 lbs" then saw "330.7 lbs" in My
 * Readings (150 kg → 150 × 2.20462 = 330.7 lb via formatWeightLbs).
 *
 * This helper is intentionally a backend-local mirror of
 * frontend/src/lib/units.ts (same constant, same rounding rule) rather
 * than a `/shared` re-export — a 3-line constant doesn't justify the
 * shared-build cycle, and keeping the conversion next to the dispatcher
 * makes the boundary obvious.
 */

const KG_PER_LB = 0.45359237

/**
 * Convert pounds to kilograms, rounded to two decimal places. Returns 0
 * for non-finite / non-positive input — callers should treat 0 as
 * "weight not provided" and omit the field from the DTO.
 *
 * Bug 24 — historically this rounded to ONE decimal place, which caused
 * a visible round-trip drift on integer-lbs inputs: 150 lbs × 0.45359237
 * = 68.0388555 kg → rounded to 68.0 kg → displayed back as 68.0 /
 * 0.45359237 = 149.914 lbs → rounded to 149.9 lbs. About half of
 * common integer-lbs values (145, 150, 160, 165, …) drifted by 0.1 lbs
 * because the 0.1 kg quantum doesn't align with 1.0 lbs. Two decimal
 * places of kg precision is the minimum that closes the gap — verified
 * round-trip-clean for 140–200 lbs.
 */
export function lbsToKg(lbs: number): number {
  if (!Number.isFinite(lbs) || lbs <= 0) return 0
  return Math.round(lbs * KG_PER_LB * 100) / 100
}

/**
 * Normalize an LLM-provided weight + unit pair to kilograms (the DB
 * storage unit). Accepts the unit case-insensitively. Defaults to LBS
 * when the unit is missing / unrecognized — preserves the pre-feature
 * tool contract where weight was implicitly lbs. Returns 0 for invalid
 * weight values so callers can treat as "not provided" and omit.
 *
 * Used by the chat + voice `submit_checkin` / `update_checkin`
 * dispatchers — see `weight_unit` on the tool declarations.
 */
export function normaliseWeightToKg(weight: number, unit?: string | null): number {
  if (!Number.isFinite(weight) || weight <= 0) return 0
  const u = typeof unit === 'string' ? unit.trim().toUpperCase() : ''
  if (u === 'KG') {
    return Math.round(weight * 10) / 10
  }
  // Default + 'LBS' branch — convert to kg.
  return lbsToKg(weight)
}

/**
 * Convert kilograms to pounds, rounded to one decimal place. Backend mirror
 * of `frontend/src/lib/units.ts:kgToLbs`. Used when emitting LBS-shaped
 * values to the frontend for display (e.g. voice CheckinSummary/UpdateSummary
 * popups, where the card hardcodes the "lbs" label).
 */
export function kgToLbs(kg: number): number {
  if (!Number.isFinite(kg) || kg <= 0) return 0
  return Math.round((kg / KG_PER_LB) * 10) / 10
}

/**
 * Convert a kilogram DELTA to pounds.
 *
 * Deliberately separate from `kgToLbs`, which returns 0 for any non-positive
 * input. A weight *delta* is legitimately negative (the patient lost weight)
 * and legitimately zero, so running a delta through `kgToLbs` would silently
 * report a 3 kg LOSS as 0 — the sign would vanish. Use this for differences,
 * `kgToLbs` for absolute weights.
 *
 * Introduced with the HF-decompensation unit fix: the rule compared a kg delta
 * against a threshold constant named `_LBS`, so it fired at 2 kg (4.41 lbs)
 * while its clinical spec (HF-ARC 2024, Manisha) says 2 lbs.
 */
export function kgDeltaToLbs(deltaKg: number): number {
  if (!Number.isFinite(deltaKg)) return 0
  return Math.round((deltaKg / KG_PER_LB) * 10) / 10
}
