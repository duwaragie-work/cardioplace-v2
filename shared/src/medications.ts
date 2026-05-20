// Phase/19 medication catalog — the canonical source for Dev 1's card-based
// intake UI (phase/14) and the phase/19 demo patient seed.
//
// Locked decision (BUILD_PLAN §0): hardcoded TS module for MVP. DB-editable
// catalog deferred to post-MVP (Priority 3).
//
// Drug-class values mirror the Prisma `DrugClass` enum — mismatches will
// break the seed at write time.

import type { DrugClassInput, MedicationFrequencyInput } from './intake.js'

export interface MedCatalogEntry {
  /** Stable key — used as the card id in the UI. */
  id: string
  brandName: string
  genericName: string
  drugClass: DrugClassInput
  /** Plain-language sentence, shown on the card (V2-B Screen 1). */
  purpose: string
  /** True for Diltiazem + Verapamil per V2-B line 344 — UI renders a distinct border. */
  isNdhpCcb?: boolean
  /** UI screen this card lives on. */
  screen: 'CORE' | 'CATEGORY' | 'COMBO'
  /** Category tab for Screen 2. Undefined for CORE / COMBO. */
  category?: 'WATER_PILL' | 'BLOOD_THINNER' | 'CHOLESTEROL' | 'HEART_RHYTHM' | 'SGLT2' | 'PAIN_RELIEVER'
}

export interface MedComboEntry {
  id: string
  brandName: string
  components: { name: string; drugClass: DrugClassInput }[]
  /** Drug classes the combo maps to for contraindication checks (V2-B line 366). */
  registersAs: DrugClassInput[]
  purpose: string
  screen: 'COMBO'
}

// ─── Screen 1 — four BP-drug classes, 16 cards ────────────────────────────────

export const CORE_MEDS: MedCatalogEntry[] = [
  // ACE inhibitors
  { id: 'lisinopril', brandName: 'Prinivil', genericName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', purpose: 'Lowers blood pressure.', screen: 'CORE' },
  { id: 'enalapril', brandName: 'Vasotec', genericName: 'Enalapril', drugClass: 'ACE_INHIBITOR', purpose: 'Lowers blood pressure.', screen: 'CORE' },
  { id: 'ramipril', brandName: 'Altace', genericName: 'Ramipril', drugClass: 'ACE_INHIBITOR', purpose: 'Lowers blood pressure.', screen: 'CORE' },
  { id: 'benazepril', brandName: 'Lotensin', genericName: 'Benazepril', drugClass: 'ACE_INHIBITOR', purpose: 'Lowers blood pressure.', screen: 'CORE' },

  // ARBs
  { id: 'losartan', brandName: 'Cozaar', genericName: 'Losartan', drugClass: 'ARB', purpose: 'Lowers blood pressure.', screen: 'CORE' },
  { id: 'valsartan', brandName: 'Diovan', genericName: 'Valsartan', drugClass: 'ARB', purpose: 'Lowers blood pressure.', screen: 'CORE' },
  { id: 'irbesartan', brandName: 'Avapro', genericName: 'Irbesartan', drugClass: 'ARB', purpose: 'Lowers blood pressure.', screen: 'CORE' },
  { id: 'olmesartan', brandName: 'Benicar', genericName: 'Olmesartan', drugClass: 'ARB', purpose: 'Lowers blood pressure.', screen: 'CORE' },

  // Beta-blockers
  { id: 'metoprolol', brandName: 'Toprol XL', genericName: 'Metoprolol', drugClass: 'BETA_BLOCKER', purpose: 'Lowers blood pressure and heart rate.', screen: 'CORE' },
  { id: 'carvedilol', brandName: 'Coreg', genericName: 'Carvedilol', drugClass: 'BETA_BLOCKER', purpose: 'Lowers blood pressure and heart rate.', screen: 'CORE' },
  { id: 'atenolol', brandName: 'Tenormin', genericName: 'Atenolol', drugClass: 'BETA_BLOCKER', purpose: 'Lowers blood pressure and heart rate.', screen: 'CORE' },
  { id: 'bisoprolol', brandName: 'Zebeta', genericName: 'Bisoprolol', drugClass: 'BETA_BLOCKER', purpose: 'Lowers blood pressure and heart rate.', screen: 'CORE' },

  // Calcium channel blockers (DHP vs NDHP split — see V2-B line 344)
  { id: 'amlodipine', brandName: 'Norvasc', genericName: 'Amlodipine', drugClass: 'DHP_CCB', purpose: 'Lowers blood pressure.', screen: 'CORE' },
  { id: 'nifedipine', brandName: 'Procardia', genericName: 'Nifedipine', drugClass: 'DHP_CCB', purpose: 'Lowers blood pressure.', screen: 'CORE' },
  { id: 'diltiazem', brandName: 'Cardizem', genericName: 'Diltiazem', drugClass: 'NDHP_CCB', purpose: 'Lowers blood pressure.', screen: 'CORE', isNdhpCcb: true },
  { id: 'verapamil', brandName: 'Calan', genericName: 'Verapamil', drugClass: 'NDHP_CCB', purpose: 'Lowers blood pressure.', screen: 'CORE', isNdhpCcb: true },
]

// ─── Screen 2 — category-guided "not listed", 12 entries ──────────────────────

export const CATEGORY_MEDS: MedCatalogEntry[] = [
  // Water pills
  { id: 'furosemide', brandName: 'Lasix', genericName: 'Furosemide', drugClass: 'LOOP_DIURETIC', purpose: 'Water pill — removes extra fluid.', screen: 'CATEGORY', category: 'WATER_PILL' },
  { id: 'hctz', brandName: 'Microzide', genericName: 'Hydrochlorothiazide', drugClass: 'THIAZIDE', purpose: 'Water pill — lowers blood pressure.', screen: 'CATEGORY', category: 'WATER_PILL' },
  { id: 'spironolactone', brandName: 'Aldactone', genericName: 'Spironolactone', drugClass: 'MRA', purpose: 'Water pill — helps heart failure.', screen: 'CATEGORY', category: 'WATER_PILL' },

  // Blood thinners
  { id: 'warfarin', brandName: 'Coumadin', genericName: 'Warfarin', drugClass: 'ANTICOAGULANT', purpose: 'Blood thinner — prevents clots.', screen: 'CATEGORY', category: 'BLOOD_THINNER' },
  { id: 'apixaban', brandName: 'Eliquis', genericName: 'Apixaban', drugClass: 'ANTICOAGULANT', purpose: 'Blood thinner — prevents clots.', screen: 'CATEGORY', category: 'BLOOD_THINNER' },
  { id: 'rivaroxaban', brandName: 'Xarelto', genericName: 'Rivaroxaban', drugClass: 'ANTICOAGULANT', purpose: 'Blood thinner — prevents clots.', screen: 'CATEGORY', category: 'BLOOD_THINNER' },

  // Statins
  { id: 'atorvastatin', brandName: 'Lipitor', genericName: 'Atorvastatin', drugClass: 'STATIN', purpose: 'Cholesterol medicine.', screen: 'CATEGORY', category: 'CHOLESTEROL' },
  { id: 'rosuvastatin', brandName: 'Crestor', genericName: 'Rosuvastatin', drugClass: 'STATIN', purpose: 'Cholesterol medicine.', screen: 'CATEGORY', category: 'CHOLESTEROL' },

  // Antiarrhythmics
  { id: 'amiodarone', brandName: 'Pacerone', genericName: 'Amiodarone', drugClass: 'ANTIARRHYTHMIC', purpose: 'Heart rhythm medicine.', screen: 'CATEGORY', category: 'HEART_RHYTHM' },
  { id: 'flecainide', brandName: 'Tambocor', genericName: 'Flecainide', drugClass: 'ANTIARRHYTHMIC', purpose: 'Heart rhythm medicine.', screen: 'CATEGORY', category: 'HEART_RHYTHM' },

  // SGLT2
  { id: 'empagliflozin', brandName: 'Jardiance', genericName: 'Empagliflozin', drugClass: 'SGLT2', purpose: 'Diabetes medicine that also helps the heart.', screen: 'CATEGORY', category: 'SGLT2' },
  { id: 'dapagliflozin', brandName: 'Farxiga', genericName: 'Dapagliflozin', drugClass: 'SGLT2', purpose: 'Diabetes medicine that also helps the heart.', screen: 'CATEGORY', category: 'SGLT2' },

  // Cluster 7 — NSAIDs. Listed so the engine can read NSAID context if a
  // patient adds one to their med list, but the primary detection surface
  // for A.3 (NSAID + antihypertensive warning) is the per-reading
  // `nsaidUse` symptom flag — most patients take these PRN, not chronically.
  { id: 'ibuprofen', brandName: 'Advil', genericName: 'Ibuprofen', drugClass: 'NSAID', purpose: 'Pain reliever (OTC). Can raise blood pressure with regular use.', screen: 'CATEGORY', category: 'PAIN_RELIEVER' },
  { id: 'naproxen', brandName: 'Aleve', genericName: 'Naproxen', drugClass: 'NSAID', purpose: 'Pain reliever (OTC). Can raise blood pressure with regular use.', screen: 'CATEGORY', category: 'PAIN_RELIEVER' },
  { id: 'celecoxib', brandName: 'Celebrex', genericName: 'Celecoxib', drugClass: 'NSAID', purpose: 'Prescription pain reliever. Can raise blood pressure with regular use.', screen: 'CATEGORY', category: 'PAIN_RELIEVER' },
]

// ─── Screen 3 — 5 combo cards ─────────────────────────────────────────────────

export const COMBO_MEDS: MedComboEntry[] = [
  {
    id: 'zestoretic',
    brandName: 'Zestoretic',
    components: [
      { name: 'Lisinopril', drugClass: 'ACE_INHIBITOR' },
      { name: 'Hydrochlorothiazide', drugClass: 'THIAZIDE' },
    ],
    registersAs: ['ACE_INHIBITOR', 'THIAZIDE'],
    purpose: 'Lowers blood pressure (2-in-1).',
    screen: 'COMBO',
  },
  {
    id: 'hyzaar',
    brandName: 'Hyzaar',
    components: [
      { name: 'Losartan', drugClass: 'ARB' },
      { name: 'Hydrochlorothiazide', drugClass: 'THIAZIDE' },
    ],
    registersAs: ['ARB', 'THIAZIDE'],
    purpose: 'Lowers blood pressure (2-in-1).',
    screen: 'COMBO',
  },
  {
    id: 'lotrel',
    brandName: 'Lotrel',
    components: [
      { name: 'Amlodipine', drugClass: 'DHP_CCB' },
      { name: 'Benazepril', drugClass: 'ACE_INHIBITOR' },
    ],
    registersAs: ['DHP_CCB', 'ACE_INHIBITOR'],
    purpose: 'Lowers blood pressure (2-in-1).',
    screen: 'COMBO',
  },
  {
    id: 'entresto',
    brandName: 'Entresto',
    components: [
      { name: 'Sacubitril', drugClass: 'ARNI' },
      { name: 'Valsartan', drugClass: 'ARB' },
    ],
    // Per V2-B line 366: "Entresto → registers as ARB → triggers pregnancy
    // contraindication check."
    registersAs: ['ARNI', 'ARB'],
    purpose: 'Heart failure medicine.',
    screen: 'COMBO',
  },
  {
    id: 'caduet',
    brandName: 'Caduet',
    components: [
      { name: 'Amlodipine', drugClass: 'DHP_CCB' },
      { name: 'Atorvastatin', drugClass: 'STATIN' },
    ],
    registersAs: ['DHP_CCB', 'STATIN'],
    purpose: 'Lowers blood pressure and cholesterol (2-in-1).',
    screen: 'COMBO',
  },
]

export const ALL_MEDS = [...CORE_MEDS, ...CATEGORY_MEDS]

// Convenience lookups.
export function findMedById(id: string): MedCatalogEntry | MedComboEntry | undefined {
  return ALL_MEDS.find((m) => m.id === id) ?? COMBO_MEDS.find((m) => m.id === id)
}

export const DEFAULT_FREQUENCY: MedicationFrequencyInput = 'ONCE_DAILY'

// ─── Phase/27 medication-list OCR helpers ───────────────────────────────────

/**
 * Result shape for catalog matches. Mirrors enough of MedCatalogEntry +
 * MedComboEntry that callers can build a SelectedMedication directly from
 * the match result.
 */
export interface CatalogMatch {
  catalogId: string
  drugName: string
  drugClass: DrugClassInput
  isCombination: boolean
  combinationComponents: DrugClassInput[]
  screen: 'CORE' | 'CATEGORY' | 'COMBO'
  /** Hand-written plain-language purpose from the shared catalog (e.g.
   *  "Lowers blood pressure."). Always present for catalog meds; the
   *  drug-enrichment service skips catalog matches and only writes
   *  PatientMedication.plainLanguageDescription for freeform meds. */
  purpose: string
}

function comboToMatch(combo: MedComboEntry): CatalogMatch {
  return {
    catalogId: combo.id,
    drugName: combo.brandName,
    drugClass: combo.registersAs[0] ?? 'OTHER_UNVERIFIED',
    isCombination: true,
    combinationComponents: combo.registersAs,
    screen: 'COMBO',
    purpose: combo.purpose,
  }
}

function entryToMatch(entry: MedCatalogEntry): CatalogMatch {
  return {
    catalogId: entry.id,
    drugName: entry.genericName,
    drugClass: entry.drugClass,
    isCombination: false,
    combinationComponents: [],
    screen: entry.screen,
    purpose: entry.purpose,
  }
}

/**
 * Best-effort match of an OCR-extracted drug name to the medication catalog.
 * Strategy:
 *   1. Exact (case-insensitive) match against generic OR brand name.
 *   2. Substring fallback — handles "Lisinopril 10mg" → "Lisinopril".
 *      Only matches when the catalog name is at least 4 chars long, to avoid
 *      "amol" → "Amlodipine" style false positives.
 *
 * Returns null when nothing matches; caller falls back to OTHER_UNVERIFIED
 * with rawInputText preserved so the provider can verify on review.
 */
export function matchToCatalog(raw: string): CatalogMatch | null {
  if (!raw || typeof raw !== 'string') return null
  const needle = raw.trim().toLowerCase()
  if (!needle) return null

  // Combos first — "Caduet" is a brand name shared with no generic, so we
  // want it to win over a substring match against "Atorvastatin".
  for (const combo of COMBO_MEDS) {
    if (combo.brandName.toLowerCase() === needle) return comboToMatch(combo)
  }

  // Then CORE + CATEGORY exact (generic OR brand)
  for (const entry of ALL_MEDS) {
    if (
      entry.genericName.toLowerCase() === needle ||
      entry.brandName.toLowerCase() === needle
    ) {
      return entryToMatch(entry)
    }
  }

  // Substring fallback — patient prescription often has "Lisinopril 10mg".
  // We require the catalog name to be ≥4 chars to prevent collisions on
  // short brand names (none currently exist but the guard is cheap).
  for (const entry of ALL_MEDS) {
    const generic = entry.genericName.toLowerCase()
    const brand = entry.brandName.toLowerCase()
    if (generic.length >= 4 && needle.includes(generic)) return entryToMatch(entry)
    if (brand.length >= 4 && needle.includes(brand)) return entryToMatch(entry)
  }
  for (const combo of COMBO_MEDS) {
    const brand = combo.brandName.toLowerCase()
    if (brand.length >= 4 && needle.includes(brand)) return comboToMatch(combo)
  }

  return null
}

/**
 * Map Gemini's free-text frequency output to the 5-value MedicationFrequency
 * enum. Returns 'UNSURE' on no match — patient confirms on the next wizard
 * step (A9).
 *
 * Order of checks matters: PRN beats once-a-day cues so a label saying "one
 * tablet as needed" doesn't get pinned to ONCE_DAILY by the lone "one";
 * three-times beats twice (else "three times" trips the "2 / two" guard via
 * a digit boundary); twice beats once for the same reason. Time-of-day cues
 * ("at night", "in the morning", "with breakfast") fall through to ONCE_DAILY
 * since each names a single dosing window.
 */
export function normaliseFrequency(raw: string): MedicationFrequencyInput {
  if (!raw || typeof raw !== 'string') return 'UNSURE'
  const s = raw.trim().toLowerCase()
  if (!s) return 'UNSURE'

  // PRN / "as needed" — must come first. A label like "one tablet as needed"
  // would otherwise tip into ONCE_DAILY via the "one" cue.
  if (/\bprn\b|\bp\.r\.n\b|\bas\s*needed\b|\bwhen\s*needed\b|\bwhen\s*required\b|\bif\s*needed\b|\bas\s*required\b/.test(s)) {
    return 'AS_NEEDED'
  }
  // Three times daily — "three times" before twice/once to dodge digit
  // collisions inside the broader patterns.
  if (/\bthree\s*times\b|\b3\s*times\b|\b3x\b|\btid\b|\bt\.i\.d\b|every\s*8\s*(hour|hr)/.test(s)) {
    return 'THREE_TIMES_DAILY'
  }
  // Twice daily — explicit "twice / 2x / BID" plus paired time-of-day cues
  // ("morning and night", "AM and PM") that imply two windows per day.
  if (/\btwice\b|\b2\s*times\b|\btwo\s*times\b|\b2x\b|\bbid\b|\bb\.i\.d\b|every\s*12\s*(hour|hr)|morning\s*and\s*(night|evening|bedtime)|am\s*and\s*pm|\bam\/pm\b/.test(s)) {
    return 'TWICE_DAILY'
  }
  // Once daily — broad catch-all plus single time-of-day cues. "at night",
  // "in the morning", "with breakfast" each name one dosing window per day.
  // The `at\s*night` / `at\s*bedtime` patterns cover "one tablet at night"
  // which is the exact phrase Manisha flagged.
  if (
    /\bonce\b|\bqd\b|\bq\.d\b|\bq\s*am\b|\bq\s*pm\b|\b1\s*time\b|\bone\s*time\b|\bdaily\b|\bper\s*day\b|every\s*24\s*(hour|hr)|at\s*night|at\s*bedtime|at\s*hs\b|\bhs\b|before\s*bed|in\s*the\s*morning|in\s*the\s*evening|with\s*breakfast|with\s*lunch|with\s*dinner|at\s*dinner|at\s*lunch|at\s*breakfast/.test(
      s,
    )
  ) {
    return 'ONCE_DAILY'
  }

  return 'UNSURE'
}
