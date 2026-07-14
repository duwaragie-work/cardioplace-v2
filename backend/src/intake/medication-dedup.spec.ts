import {
  resolveCanonicalDrugId,
  medicationRestrictiveness,
  pickMostRestrictive,
} from './medication-dedup.js'
import {
  MedicationHoldReason,
  MedicationVerificationStatus,
} from '../generated/prisma/client.js'

describe('#85 resolveCanonicalDrugId — brand/generic → canonical', () => {
  it('brand and generic of the same drug resolve to the SAME canonical id', () => {
    expect(resolveCanonicalDrugId('Cozaar')).toBe('losartan')
    expect(resolveCanonicalDrugId('Losartan')).toBe('losartan')
  })

  it('is case-insensitive and tolerates a dose suffix (substring match)', () => {
    expect(resolveCanonicalDrugId('lisinopril 10mg')).toBe('lisinopril')
    expect(resolveCanonicalDrugId('PRINIVIL')).toBe('lisinopril')
  })

  it('off-catalog / null names resolve to null (dedup intentionally skipped)', () => {
    expect(resolveCanonicalDrugId('Some Herbal Supplement XYZ')).toBeNull()
    expect(resolveCanonicalDrugId('')).toBeNull()
    expect(resolveCanonicalDrugId(null)).toBeNull()
    expect(resolveCanonicalDrugId(undefined)).toBeNull()
  })
})

describe('#85 medicationRestrictiveness — most-restrictive ordering', () => {
  const r = (verificationStatus: MedicationVerificationStatus, holdReason: MedicationHoldReason | null = null) =>
    medicationRestrictiveness({ verificationStatus, holdReason })

  it('PROVIDER_DIRECTED_HOLD outranks every other state', () => {
    const pdh = r(MedicationVerificationStatus.HOLD, MedicationHoldReason.PROVIDER_DIRECTED_HOLD)
    expect(pdh).toBeGreaterThan(r(MedicationVerificationStatus.HOLD, MedicationHoldReason.AWAITING_RECORDS))
    expect(pdh).toBeGreaterThan(r(MedicationVerificationStatus.VERIFIED))
    expect(pdh).toBeGreaterThan(r(MedicationVerificationStatus.UNVERIFIED))
  })

  it('admin holds outrank VERIFIED, which outranks UNVERIFIED, which outranks REJECTED', () => {
    expect(r(MedicationVerificationStatus.HOLD, MedicationHoldReason.AWAITING_RECORDS))
      .toBeGreaterThan(r(MedicationVerificationStatus.VERIFIED))
    expect(r(MedicationVerificationStatus.VERIFIED))
      .toBeGreaterThan(r(MedicationVerificationStatus.UNVERIFIED))
    expect(r(MedicationVerificationStatus.UNVERIFIED))
      .toBeGreaterThan(r(MedicationVerificationStatus.REJECTED))
  })
})

describe('#85 pickMostRestrictive — keeper selection', () => {
  const med = (
    id: string,
    verificationStatus: MedicationVerificationStatus,
    holdReason: MedicationHoldReason | null,
    reportedAt: string,
  ) => ({ id, verificationStatus, holdReason, reportedAt: new Date(reportedAt) })

  it('keeps the clinical hold over a VERIFIED brand duplicate (the Cozaar/Losartan risk)', () => {
    const cozaarHold = med('cozaar', MedicationVerificationStatus.HOLD, MedicationHoldReason.PROVIDER_DIRECTED_HOLD, '2026-05-01')
    const losartanVerified = med('losartan', MedicationVerificationStatus.VERIFIED, null, '2026-05-02')
    expect(pickMostRestrictive([losartanVerified, cozaarHold])?.id).toBe('cozaar')
  })

  it('breaks ties by oldest reportedAt (original record wins)', () => {
    const a = med('a', MedicationVerificationStatus.VERIFIED, null, '2026-05-02')
    const b = med('b', MedicationVerificationStatus.VERIFIED, null, '2026-05-01')
    expect(pickMostRestrictive([a, b])?.id).toBe('b')
  })

  it('returns null for an empty set', () => {
    expect(pickMostRestrictive([])).toBeNull()
  })
})
