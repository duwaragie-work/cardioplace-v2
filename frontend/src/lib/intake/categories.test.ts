import { CATEGORY_MEDS } from '@cardioplace/shared'
import { categoriesForSelectedMeds } from './categories'

// B4 — the A8 "other medicines" step auto-expands the category card holding a
// selected (e.g. scan-matched) med. This is the logic both the mount-time
// initializer and the reactive effect use; a scan adds a catalog med AFTER
// mount, so the effect must surface its category.

const waterPill = CATEGORY_MEDS.find((c) => c.category === 'WATER_PILL')!
const bloodThinner = CATEGORY_MEDS.find((c) => c.category === 'BLOOD_THINNER')!

describe('categoriesForSelectedMeds (B4)', () => {
  it('returns the category of a selected catalog med (water pill)', () => {
    const cats = categoriesForSelectedMeds([{ catalogId: waterPill.id }])
    expect(cats.has('WATER_PILL')).toBe(true)
    expect(cats.size).toBe(1)
  })

  it('unions categories across multiple selected catalog meds', () => {
    const cats = categoriesForSelectedMeds([
      { catalogId: waterPill.id },
      { catalogId: bloodThinner.id },
    ])
    expect([...cats].sort()).toEqual(['BLOOD_THINNER', 'WATER_PILL'])
  })

  it('ignores meds with no catalogId (free-text / OTHER_UNVERIFIED)', () => {
    const cats = categoriesForSelectedMeds([
      { catalogId: null },
      { catalogId: undefined },
      {},
    ])
    expect(cats.size).toBe(0)
  })

  it('ignores a catalogId that is not a category med (e.g. a CORE drug)', () => {
    // lisinopril is a CORE med (no category) — must not expand any A8 card.
    const cats = categoriesForSelectedMeds([{ catalogId: 'lisinopril' }])
    expect(cats.size).toBe(0)
  })

  it('returns an empty set for no selections', () => {
    expect(categoriesForSelectedMeds([]).size).toBe(0)
  })
})
