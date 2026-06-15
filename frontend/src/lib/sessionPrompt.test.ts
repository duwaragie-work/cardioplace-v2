// Q3 hybrid prompt-selection branch (Manisha 2026-06-12 Q3 — Option C).
// Asserts the AFib cohort always gets the 3-reading variant and the non-AFib
// cohort gets the single→second-reading nudge — the two branches must never
// cross, regardless of the backend finalize hint.
import { selectReadingPrompt } from './sessionPrompt'

describe('selectReadingPrompt — AFib 3-reading variant', () => {
  it('first reading → state1, needs more, not satisfied', () => {
    const p = selectReadingPrompt({ hasAFib: true, sessionTotal: 1, pendingFinalizeEntryId: null })
    expect(p).toEqual({ kind: 'afib', stateKey: 'state1', needsMoreReadings: true, satisfied: false })
  })

  it('second reading → state2, still needs more', () => {
    const p = selectReadingPrompt({ hasAFib: true, sessionTotal: 2, pendingFinalizeEntryId: null })
    expect(p).toEqual({ kind: 'afib', stateKey: 'state2', needsMoreReadings: true, satisfied: false })
  })

  it('third reading → state3, satisfied, no longer needs more', () => {
    const p = selectReadingPrompt({ hasAFib: true, sessionTotal: 3, pendingFinalizeEntryId: null })
    expect(p).toEqual({ kind: 'afib', stateKey: 'state3', needsMoreReadings: false, satisfied: true })
  })

  it('AFib never falls through to the non-AFib 2nd-reading nudge even if the backend hint is set', () => {
    const p = selectReadingPrompt({ hasAFib: true, sessionTotal: 1, pendingFinalizeEntryId: 'entry-123' })
    expect(p.kind).toBe('afib')
  })
})

describe('selectReadingPrompt — non-AFib default', () => {
  it('pending finalize hint → take-second nudge', () => {
    const p = selectReadingPrompt({ hasAFib: false, sessionTotal: 1, pendingFinalizeEntryId: 'entry-123' })
    expect(p).toEqual({ kind: 'takeSecond' })
  })

  it('no pending hint → no nudge', () => {
    const p = selectReadingPrompt({ hasAFib: false, sessionTotal: 1, pendingFinalizeEntryId: null })
    expect(p).toEqual({ kind: 'none' })
  })

  it('non-AFib never shows an afib-state prompt', () => {
    const p = selectReadingPrompt({ hasAFib: false, sessionTotal: 2, pendingFinalizeEntryId: 'entry-9' })
    expect(p.kind).not.toBe('afib')
  })
})

describe('selectReadingPrompt — Bug 8 emergency suppression', () => {
  it('non-AFib emergency suppresses the 2nd-reading nudge even when the finalize hint is set', () => {
    const p = selectReadingPrompt({
      hasAFib: false,
      sessionTotal: 1,
      pendingFinalizeEntryId: 'entry-123',
      isEmergency: true,
    })
    expect(p).toEqual({ kind: 'none' })
  })

  it('AFib emergency suppresses the 3-reading prompt (patient must see the emergency CTA)', () => {
    const p = selectReadingPrompt({
      hasAFib: true,
      sessionTotal: 1,
      pendingFinalizeEntryId: null,
      isEmergency: true,
    })
    expect(p).toEqual({ kind: 'none' })
  })

  it('non-emergency is unaffected (isEmergency:false behaves as before)', () => {
    const p = selectReadingPrompt({
      hasAFib: false,
      sessionTotal: 1,
      pendingFinalizeEntryId: 'entry-123',
      isEmergency: false,
    })
    expect(p).toEqual({ kind: 'takeSecond' })
  })
})
