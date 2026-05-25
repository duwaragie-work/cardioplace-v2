import { consolidateAlertsByEntry, type ConsolidatableAlert } from './consolidate'

// B2 (patient) — co-fired alerts from one reading collapse into a single card.

function a(over: Partial<ConsolidatableAlert> = {}): ConsolidatableAlert {
  return { id: 'a1', status: 'OPEN', severity: 'MEDIUM', escalated: false, type: 'SYSTOLIC_BP', ...over }
}

describe('consolidateAlertsByEntry (B2)', () => {
  it('merges two alerts sharing a journal entry into one card', () => {
    const out = consolidateAlertsByEntry([
      a({ id: 'a1', journalEntry: { id: 'je-1' }, type: 'SYSTOLIC_BP' }),
      a({ id: 'a2', journalEntry: { id: 'je-1' }, type: 'DIASTOLIC_BP' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('BP_COMBINED') // systolic + diastolic → combined
  })

  it('keeps alerts from different readings as separate cards', () => {
    const out = consolidateAlertsByEntry([
      a({ id: 'a1', journalEntry: { id: 'je-1' } }),
      a({ id: 'a2', journalEntry: { id: 'je-2' } }),
    ])
    expect(out).toHaveLength(2)
  })

  it('a merged card is OPEN if any member is OPEN, and escalated if any escalated', () => {
    const out = consolidateAlertsByEntry([
      a({ id: 'a1', journalEntry: { id: 'je-1' }, status: 'RESOLVED', escalated: false }),
      a({ id: 'a2', journalEntry: { id: 'je-1' }, status: 'OPEN', escalated: true }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].status).toBe('OPEN')
    expect(out[0].escalated).toBe(true)
  })

  it('a merged card takes the worst (HIGH) severity', () => {
    const out = consolidateAlertsByEntry([
      a({ id: 'a1', journalEntry: { id: 'je-1' }, severity: 'MEDIUM' }),
      a({ id: 'a2', journalEntry: { id: 'je-1' }, severity: 'HIGH' }),
    ])
    expect(out[0].severity).toBe('HIGH')
  })

  it('falls back to the alert id when there is no journal entry (no accidental merge)', () => {
    const out = consolidateAlertsByEntry([
      a({ id: 'a1', journalEntry: null }),
      a({ id: 'a2', journalEntry: null }),
    ])
    expect(out).toHaveLength(2)
  })

  it('leaves a single alert untouched', () => {
    const out = consolidateAlertsByEntry([a({ id: 'solo', journalEntry: { id: 'je-9' }, type: 'SYSTOLIC_BP' })])
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('SYSTOLIC_BP')
  })
})
