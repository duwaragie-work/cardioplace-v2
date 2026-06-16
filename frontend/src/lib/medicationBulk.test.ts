import { applyBulkMedicationStatus } from './medicationBulk'

type E = { taken: 'yes' | 'no' | 'scheduledLater' | null; reason: string | null; missedDoses: number }

const DEFAULT: E = { taken: null, reason: null, missedDoses: 1 }
const makeAnswered = (prev: E | undefined, v: 'yes' | 'no'): E =>
  v === 'no'
    ? { ...(prev ?? DEFAULT), taken: 'no' }
    : { taken: 'yes', reason: null, missedDoses: 1 }

describe('applyBulkMedicationStatus (Bug 17)', () => {
  it('marks all UNANSWERED meds taken', () => {
    const out = applyBulkMedicationStatus<E>({}, ['a', 'b', 'c'], 'yes', makeAnswered)
    expect(out.a.taken).toBe('yes')
    expect(out.b.taken).toBe('yes')
    expect(out.c.taken).toBe('yes')
  })

  it('marks all UNANSWERED meds not-taken', () => {
    const out = applyBulkMedicationStatus<E>({}, ['a', 'b'], 'no', makeAnswered)
    expect(out.a.taken).toBe('no')
    expect(out.b.taken).toBe('no')
  })

  it('Bug 21b — absolute setter: OVERWRITES an answer the patient already gave', () => {
    const current: Record<string, E> = {
      a: { taken: 'no', reason: 'FORGOT', missedDoses: 2 },
      b: DEFAULT,
    }
    const out = applyBulkMedicationStatus<E>(current, ['a', 'b'], 'yes', makeAnswered)
    // Both flip to yes — the bulk button is unconditional, not "fill empties".
    expect(out.a.taken).toBe('yes')
    expect(out.b.taken).toBe('yes')
  })

  it('Bug 21b — "not taken" flips everything even after "all taken"', () => {
    const allTaken: Record<string, E> = {
      a: { taken: 'yes', reason: null, missedDoses: 1 },
      b: { taken: 'yes', reason: null, missedDoses: 1 },
    }
    const out = applyBulkMedicationStatus<E>(allTaken, ['a', 'b'], 'no', makeAnswered)
    expect(out.a.taken).toBe('no')
    expect(out.b.taken).toBe('no')
  })
})
