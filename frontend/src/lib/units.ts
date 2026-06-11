// Phase/26 silent-literacy — US-units conversion helpers.
//
// Storage stays metric (heightCm: Int, weight: Decimal kg) on the backend.
// Display + input convert at the form boundary so existing patient rows keep
// working without a data migration. Pure functions, no React or i18n.

const KG_PER_LB = 0.45359237
const CM_PER_INCH = 2.54
const INCHES_PER_FOOT = 12

/**
 * Convert centimetres to a feet/inches pair, rounding inches to the nearest
 * whole number. 0 cm → { feet: 0, inches: 0 }. Negative input clamps to 0.
 */
export function cmToFtIn(cm: number): { feet: number; inches: number } {
  if (!Number.isFinite(cm) || cm <= 0) return { feet: 0, inches: 0 }
  const totalInches = Math.round(cm / CM_PER_INCH)
  const feet = Math.floor(totalInches / INCHES_PER_FOOT)
  const inches = totalInches % INCHES_PER_FOOT
  return { feet, inches }
}

/**
 * Convert a feet/inches pair to centimetres, rounded to the nearest whole cm.
 * Negative or non-finite inputs clamp to 0.
 */
export function ftInToCm(feet: number, inches: number): number {
  const f = Number.isFinite(feet) && feet > 0 ? feet : 0
  const i = Number.isFinite(inches) && inches > 0 ? inches : 0
  const totalInches = f * INCHES_PER_FOOT + i
  return Math.round(totalInches * CM_PER_INCH)
}

/**
 * Convert kilograms to pounds, rounded to one decimal place.
 */
export function kgToLbs(kg: number): number {
  if (!Number.isFinite(kg) || kg <= 0) return 0
  return Math.round((kg / KG_PER_LB) * 10) / 10
}

/**
 * Convert pounds to kilograms, rounded to two decimal places.
 *
 * Bug 24 — was one decimal place, which caused integer-lbs inputs to
 * drift on display. 150 lbs → 68.0388555 kg → rounded to 68.0 →
 * displayed back as 149.9 lbs. About half of common integer-lbs values
 * drift by 0.1 lbs at 1 dp because the 0.1 kg quantum doesn't align
 * with 1.0 lbs. 2 dp is the minimum that round-trips cleanly.
 * Backend `lbsToKg` in src/common/units.ts mirrors this — keep in sync.
 */
export function lbsToKg(lbs: number): number {
  if (!Number.isFinite(lbs) || lbs <= 0) return 0
  return Math.round(lbs * KG_PER_LB * 100) / 100
}

/**
 * Format a centimetres value as `5'9"` for display. Returns an em-dash for
 * null / 0 / non-finite input so callers can use it directly in JSX.
 */
export function formatHeightFtIn(cm: number | null | undefined): string {
  if (cm == null || !Number.isFinite(cm) || cm <= 0) return '—'
  const { feet, inches } = cmToFtIn(cm)
  return `${feet}'${inches}"`
}

/**
 * Format a kilograms value as `154.3 lb` for display. Returns an em-dash on
 * null / 0 / non-finite input.
 */
export function formatWeightLbs(kg: number | null | undefined): string {
  if (kg == null || !Number.isFinite(kg) || kg <= 0) return '—'
  return `${kgToLbs(kg).toFixed(1)} lb`
}
