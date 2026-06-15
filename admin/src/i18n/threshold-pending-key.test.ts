import en from './en'
import es from './es'
import fr from './fr'
import de from './de'
import am from './am'

// Manisha 2026-06-12 — the threshold-pending alert badge is the only fully-
// translated string in the new dispatch-gate work. Guard that every supported
// locale carries a non-empty value (am is type-cast in the registry, so the
// compiler won't catch a missing key there — this runtime check does).
describe('alerts.badge.thresholdPending i18n', () => {
  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['de', de],
    ['am', am],
  ])('%s carries a non-empty translation', (_loc, dict) => {
    const v = (dict as Record<string, string>)['alerts.badge.thresholdPending']
    expect(typeof v).toBe('string')
    expect(v.trim().length).toBeGreaterThan(0)
  })
})
