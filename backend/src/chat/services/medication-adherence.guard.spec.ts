import { jest } from '@jest/globals'
import { MedicationAdherenceService } from './medication-adherence.service.js'

/**
 * #2b (2026-07-18) — flag-gated clinical-safety guard on chat medication
 * adherence. Reported: chat marked a medication "missed" without ever asking
 * the patient, minting an adherence alert (RULE_MEDICATION_MISSED) they never
 * earned. `medication_taken=false` / `status:'missed'` passed straight through.
 *
 * Guard: when MED_ADHERENCE_CONFIRM_GUARD_ENABLED='true', a "missed" with no
 * patient-sourced detail (no reason) is recorded as non-alerting instead of a
 * genuine miss. DEFAULT OFF — enabling changes what fires an alert → Manisha.
 *
 * These assert the write path (`log`) sets a DTO that will / won't fire the
 * rule. The engine's `medicationTaken === false` firing condition is covered by
 * engine/adherence.ts's own tests — here we prove what the DTO carries.
 */

const med = { id: 'med-1', drugName: 'lisinopril', drugClass: 'ACE_INHIBITOR' }

function makeService(createSpy: jest.Mock) {
  const prisma = {
    patientMedication: { findFirst: jest.fn(async () => med) },
  }
  const journal = { create: createSpy }
  return new MedicationAdherenceService(prisma as never, journal as never)
}

function lastDto(createSpy: jest.Mock): Record<string, unknown> {
  return createSpy.mock.calls[0]?.[1] as Record<string, unknown>
}

describe('MedicationAdherenceService — #2b unconfirmed-missed guard', () => {
  const orig = process.env.MED_ADHERENCE_CONFIRM_GUARD_ENABLED
  const createSpy = jest.fn(async () => ({ data: { id: 'entry-1' } })) as jest.Mock

  beforeEach(() => {
    createSpy.mockClear()
    createSpy.mockResolvedValue({ data: { id: 'entry-1' } } as never)
  })
  afterAll(() => {
    process.env.MED_ADHERENCE_CONFIRM_GUARD_ENABLED = orig
  })

  it('flag OFF: a reasonless "missed" still records a real miss (today\'s behavior)', async () => {
    process.env.MED_ADHERENCE_CONFIRM_GUARD_ENABLED = 'false'
    const svc = makeService(createSpy)

    await svc.log('user-1', { medicationId: 'med-1', status: 'missed' })

    const dto = lastDto(createSpy)
    expect(dto.medicationTaken).toBe(false) // fires RULE_MEDICATION_MISSED
    expect(dto.medicationScheduledLater).toBeUndefined()
  })

  it('flag ON + no reason: neutralized to non-alerting (does NOT fire the rule)', async () => {
    process.env.MED_ADHERENCE_CONFIRM_GUARD_ENABLED = 'true'
    const svc = makeService(createSpy)

    await svc.log('user-1', { medicationId: 'med-1', status: 'missed' })

    const dto = lastDto(createSpy)
    expect(dto.medicationTaken).toBeUndefined() // rule skips (no false miss-day)
    expect(dto.medicationScheduledLater).toBe(true)
  })

  it('flag ON + reason present: a CONFIRMED miss still records (patient told us why)', async () => {
    process.env.MED_ADHERENCE_CONFIRM_GUARD_ENABLED = 'true'
    const svc = makeService(createSpy)

    await svc.log('user-1', { medicationId: 'med-1', status: 'missed', reason: 'FORGOT' })

    const dto = lastDto(createSpy)
    expect(dto.medicationTaken).toBe(false) // genuine miss → still fires
  })

  it('flag ON: "taken" is unaffected', async () => {
    process.env.MED_ADHERENCE_CONFIRM_GUARD_ENABLED = 'true'
    const svc = makeService(createSpy)

    await svc.log('user-1', { medicationId: 'med-1', status: 'taken' })

    expect(lastDto(createSpy).medicationTaken).toBe(true)
  })
})
