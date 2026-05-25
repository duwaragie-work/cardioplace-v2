import { jest } from '@jest/globals'
import { loadAdherenceWindow } from './adherence-window.js'
import type { PrismaService } from '../../prisma/prisma.service.js'

// HOLD-ADHERENCE (CLINICAL_SPEC §14.2) — meds placed on HOLD by the care team
// must not count as missed doses; the patient is correctly not taking them.
describe('loadAdherenceWindow — HOLD exclusion', () => {
  const anchor = new Date('2026-05-20T12:00:00Z')
  const tz = 'America/New_York'

  function makePrisma(entries: any[], heldIds: string[]) {
    return {
      journalEntry: {
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue(entries),
      },
      patientMedication: {
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue(
          heldIds.map((id) => ({ id })),
        ),
      },
    } as unknown as PrismaService
  }

  it('a missed dose of a HELD med does not count as a miss-day', async () => {
    const prisma = makePrisma(
      [
        {
          id: 'j1',
          measuredAt: anchor,
          medicationTaken: false,
          missedMedications: [
            { medicationId: 'held-1', drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', missedDoses: 1 },
          ],
        },
      ],
      ['held-1'],
    )

    const w = await loadAdherenceWindow(prisma, 'u1', anchor, tz)

    expect(w.daysWithMiss).toBe(0)
    expect(w.daysWithMissOver7d).toBe(0)
    expect(w.missedMedications).toHaveLength(0)
  })

  it('a missed dose of a non-held med still counts', async () => {
    const prisma = makePrisma(
      [
        {
          id: 'j1',
          measuredAt: anchor,
          medicationTaken: false,
          missedMedications: [
            { medicationId: 'm2', drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER', missedDoses: 1 },
          ],
        },
      ],
      [],
    )

    const w = await loadAdherenceWindow(prisma, 'u1', anchor, tz)

    expect(w.daysWithMiss).toBe(1)
    expect(w.missedMedications).toHaveLength(1)
    expect(w.missedMedications[0].drugClass).toBe('BETA_BLOCKER')
  })

  it('mixed entry: held med dropped, non-held med retained', async () => {
    const prisma = makePrisma(
      [
        {
          id: 'j1',
          measuredAt: anchor,
          medicationTaken: false,
          missedMedications: [
            { medicationId: 'held-1', drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', missedDoses: 1 },
            { medicationId: 'm2', drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER', missedDoses: 1 },
          ],
        },
      ],
      ['held-1'],
    )

    const w = await loadAdherenceWindow(prisma, 'u1', anchor, tz)

    expect(w.daysWithMiss).toBe(1)
    expect(w.missedMedications).toHaveLength(1)
    expect(w.missedMedications[0].medicationId).toBe('m2')
    expect(w.missesByDrugClass.get('BETA_BLOCKER')).toBe(1)
    expect(w.missesByDrugClass.has('ACE_INHIBITOR')).toBe(false)
  })
})
