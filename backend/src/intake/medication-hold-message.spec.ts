import {
  systemMsgMedicationHold,
  isProviderDirectedHold,
} from '@cardioplace/shared'

// W1 (Manisha 5/24 Med §3, patient-safety #1) — the HOLD patient message MUST
// branch on the reason. A provider-directed hold tells the patient to pause the
// med; an administrative hold must NOT tell them to stop a medication they are
// correctly taking (abrupt β-blocker discontinuation for a paperwork delay can
// cause rebound harm).
describe('systemMsgMedicationHold — two-path patient message (W1)', () => {
  it('PROVIDER_DIRECTED_HOLD: names the med and says do not take it', () => {
    const msg = systemMsgMedicationHold('Metoprolol', 'PROVIDER_DIRECTED_HOLD')
    expect(msg).toMatch(/Metoprolol/)
    expect(msg).toMatch(/pause/i)
    expect(msg).toMatch(/do not take/i)
    expect(isProviderDirectedHold('PROVIDER_DIRECTED_HOLD')).toBe(true)
  })

  it.each([
    'AWAITING_RECORDS',
    'UNCLEAR_NAME',
    'UNCLEAR_DOSE',
    'OTHER',
  ] as const)('administrative (%s): says keep taking and does NOT name the med', (reason) => {
    const msg = systemMsgMedicationHold('Metoprolol', reason)
    expect(msg).toMatch(/keep taking/i)
    expect(msg).not.toMatch(/Metoprolol/)
    expect(msg).not.toMatch(/do not take/i)
    expect(isProviderDirectedHold(reason)).toBe(false)
  })
})
