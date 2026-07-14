import { CATEGORY_MEDS } from '@cardioplace/shared'

/**
 * The A8 "other medicines" category keys (WATER_PILL, BLOOD_THINNER, …) for any
 * selected meds that are CATEGORY_MEDS catalog entries. Single source for the
 * A8 step's auto-expand: the mount-time initializer AND the reactive effect both
 * use it, so a scan-matched (or any late-added) category med reveals its card.
 */
export function categoriesForSelectedMeds(
  meds: ReadonlyArray<{ catalogId?: string | null }>,
): Set<string> {
  const set = new Set<string>()
  for (const m of meds) {
    if (!m.catalogId) continue
    const cat = CATEGORY_MEDS.find((c) => c.id === m.catalogId)
    if (cat?.category) set.add(cat.category)
  }
  return set
}
