import { jest } from '@jest/globals'
import { retroUpgradeAceArbHoldsForContraindication } from './ace-contraindication.js'

// #84 — retro-upgrade existing ACE/ARB holds to PROVIDER_DIRECTED_HOLD when the
// angioedema contraindication flag is set. Pure unit tests against a stub tx.

function makeTx(meds: any[]) {
  return {
    patientMedication: {
      findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue(meds),
      update: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
    },
    profileVerificationLog: {
      create: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
    },
  }
}

const baseArgs = {
  userId: 'user-1',
  changedBy: 'admin-1',
  changedByRole: 'ADMIN' as const,
  reason: 'Angioedema contraindication',
  // V-06 — the helper stores `rationaleEncrypted` alongside `rationale` on the
  // audit row. Callers must precompute; the test supplies a static envelope
  // shape (unit tests don't exercise real crypto).
  reasonEncrypted: 'iv:tag:ct',
  now: new Date('2026-06-03T10:00:00Z'),
}

describe('retroUpgradeAceArbHoldsForContraindication (#84)', () => {
  it('only queries live ACE/ARB on benign holds OR verified (idempotent candidate set)', async () => {
    const tx = makeTx([])
    await retroUpgradeAceArbHoldsForContraindication(tx as any, baseArgs)

    const where = (tx.patientMedication.findMany.mock.calls[0][0] as any).where
    expect(where.userId).toBe('user-1')
    expect(where.drugClass).toEqual({ in: ['ACE_INHIBITOR', 'ARB'] })
    expect(where.discontinuedAt).toBeNull()
    // OR branch 1 — HOLD on administrative reasons only (PROVIDER_DIRECTED_HOLD
    // excluded so a second run upgrades nothing).
    expect(where.OR[0]).toEqual({
      verificationStatus: 'HOLD',
      holdReason: { in: ['AWAITING_RECORDS', 'UNCLEAR_NAME', 'UNCLEAR_DOSE', 'OTHER'] },
    })
    expect(where.OR[1]).toEqual({ verificationStatus: 'VERIFIED' })
  })

  it('upgrades an ACE on AWAITING_RECORDS to PROVIDER_DIRECTED_HOLD + audit row', async () => {
    const tx = makeTx([
      {
        id: 'med-ace',
        drugClass: 'ACE_INHIBITOR',
        verificationStatus: 'HOLD',
        holdReason: 'AWAITING_RECORDS',
      },
    ])

    const count = await retroUpgradeAceArbHoldsForContraindication(tx as any, baseArgs)
    expect(count).toBe(1)

    const updateArg = tx.patientMedication.update.mock.calls[0][0] as any
    expect(updateArg.where).toEqual({ id: 'med-ace' })
    expect(updateArg.data.verificationStatus).toBe('HOLD')
    expect(updateArg.data.holdReason).toBe('PROVIDER_DIRECTED_HOLD')
    // Already-HOLD med keeps its original holdSetAt (no reset).
    expect(updateArg.data.holdSetAt).toBeUndefined()
    expect(updateArg.data.holdEscalationLevel).toBeUndefined()

    const logArg = tx.profileVerificationLog.create.mock.calls[0][0] as any
    expect(logArg.data.userId).toBe('user-1')
    expect(logArg.data.fieldPath).toBe('medication:med-ace:holdReason')
    expect(logArg.data.previousValue).toEqual({
      verificationStatus: 'HOLD',
      holdReason: 'AWAITING_RECORDS',
    })
    expect(logArg.data.newValue).toEqual({
      verificationStatus: 'HOLD',
      holdReason: 'PROVIDER_DIRECTED_HOLD',
    })
    expect(logArg.data.changeType).toBe('ADMIN_CORRECT')
    expect(logArg.data.discrepancyFlag).toBe(true)
  })

  it('upgrades a VERIFIED ARB to HOLD/PROVIDER_DIRECTED and anchors a fresh ladder', async () => {
    const tx = makeTx([
      {
        id: 'med-arb',
        drugClass: 'ARB',
        verificationStatus: 'VERIFIED',
        holdReason: null,
      },
    ])

    await retroUpgradeAceArbHoldsForContraindication(tx as any, baseArgs)

    const updateArg = tx.patientMedication.update.mock.calls[0][0] as any
    expect(updateArg.data.verificationStatus).toBe('HOLD')
    expect(updateArg.data.holdReason).toBe('PROVIDER_DIRECTED_HOLD')
    // VERIFIED → HOLD anchors the reconciliation ladder fresh.
    expect(updateArg.data.holdSetAt).toEqual(baseArgs.now)
    expect(updateArg.data.holdEscalationLevel).toBe(0)
  })

  it('no live candidates → no writes (idempotent re-run)', async () => {
    const tx = makeTx([])
    const count = await retroUpgradeAceArbHoldsForContraindication(tx as any, baseArgs)
    expect(count).toBe(0)
    expect(tx.patientMedication.update).not.toHaveBeenCalled()
    expect(tx.profileVerificationLog.create).not.toHaveBeenCalled()
  })

  it('processes every returned candidate (one audit row each)', async () => {
    const tx = makeTx([
      { id: 'm1', drugClass: 'ACE_INHIBITOR', verificationStatus: 'HOLD', holdReason: 'UNCLEAR_NAME' },
      { id: 'm2', drugClass: 'ACE_INHIBITOR', verificationStatus: 'VERIFIED', holdReason: null },
      { id: 'm3', drugClass: 'ARB', verificationStatus: 'HOLD', holdReason: 'OTHER' },
    ])
    const count = await retroUpgradeAceArbHoldsForContraindication(tx as any, baseArgs)
    expect(count).toBe(3)
    expect(tx.patientMedication.update).toHaveBeenCalledTimes(3)
    expect(tx.profileVerificationLog.create).toHaveBeenCalledTimes(3)
  })
})
