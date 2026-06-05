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
 * Convert pounds to kilograms, rounded to one decimal place. Returns 0
 * for non-finite / non-positive input — callers should treat 0 as
 * "weight not provided" and omit the field from the DTO.
 */
export function lbsToKg(lbs: number): number {
  if (!Number.isFinite(lbs) || lbs <= 0) return 0
  return Math.round(lbs * KG_PER_LB * 10) / 10
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
