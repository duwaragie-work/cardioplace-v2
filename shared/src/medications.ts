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
  category?: 'WATER_PILL' | 'BLOOD_THINNER' | 'CHOLESTEROL' | 'HEART_RHYTHM' | 'SGLT2'
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
