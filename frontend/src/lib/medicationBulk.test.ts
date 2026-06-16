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

  it('does NOT overwrite an answer the patient already gave', () => {
    const current: Record<string, E> = {
      a: { taken: 'no', reason: 'FORGOT', missedDoses: 2 },
      b: DEFAULT,
    }
    const out = applyBulkMedicationStatus<E>(current, ['a', 'b'], 'yes', makeAnswered)
    // 'a' keeps its explicit miss + reason; only 'b' flips.
    expect(out.a).toEqual({ taken: 'no', reason: 'FORGOT', missedDoses: 2 })
    expect(out.b.taken).toBe('yes')
  })

  it('is a no-op when every med is already answered', () => {
    const current: Record<string, E> = {
      a: { taken: 'yes', reason: null, missedDoses: 1 },
      b: { taken: 'scheduledLater', reason: null, missedDoses: 1 },
    }
    const out = applyBulkMedicationStatus<E>(current, ['a', 'b'], 'no', makeAnswered)
    expect(out).toEqual(current)
  })
})
