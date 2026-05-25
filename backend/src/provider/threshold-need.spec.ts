import {
  computeNeedsThreshold,
  mandatoryConditionChangedAt,
  thresholdMandatory,
} from './threshold-need.js'

describe('threshold-need', () => {
  const NON_MANDATORY = { hasHCM: false, hasDCM: false, heartFailureType: 'NOT_APPLICABLE' }
  const HCM = { hasHCM: true, hasDCM: false, heartFailureType: 'NOT_APPLICABLE' }

  describe('thresholdMandatory', () => {
    it('true for HCM / DCM / HFrEF, false otherwise', () => {
      expect(thresholdMandatory(HCM)).toBe(true)
      expect(thresholdMandatory({ hasDCM: true })).toBe(true)
      expect(thresholdMandatory({ heartFailureType: 'HFREF' })).toBe(true)
      expect(thresholdMandatory(NON_MANDATORY)).toBe(false)
      expect(thresholdMandatory(null)).toBe(false)
    })
  })

  describe('mandatoryConditionChangedAt', () => {
    it('picks the latest HCM/DCM change and HFREF transitions', () => {
      const at = mandatoryConditionChangedAt([
        { fieldPath: 'profile.hasHCM', previousValue: false, newValue: true, createdAt: '2026-05-01T00:00:00Z' },
        { fieldPath: 'profile.heartFailureType', previousValue: 'HFREF', newValue: 'NOT_APPLICABLE', createdAt: '2026-05-03T00:00:00Z' },
      ])
      expect(at).toBe(new Date('2026-05-03T00:00:00Z').getTime())
    })

    it('ignores heartFailureType changes that do not involve HFREF', () => {
      const at = mandatoryConditionChangedAt([
        { fieldPath: 'profile.heartFailureType', previousValue: 'HFPEF', newValue: 'UNKNOWN', createdAt: '2026-05-03T00:00:00Z' },
      ])
      expect(at).toBeNull()
    })

    it('returns null with no relevant logs', () => {
      expect(mandatoryConditionChangedAt([])).toBeNull()
    })
  })

  describe('computeNeedsThreshold', () => {
    it('MISSING: mandatory + no threshold', () => {
      expect(
        computeNeedsThreshold({ profile: HCM, thresholdSetAt: null, conditionLogs: [] }),
      ).toBe(true)
    })

    it('not needed: non-mandatory + no threshold', () => {
      expect(
        computeNeedsThreshold({ profile: NON_MANDATORY, thresholdSetAt: null, conditionLogs: [] }),
      ).toBe(false)
    })

    it('STALE: condition changed after the threshold was set', () => {
      expect(
        computeNeedsThreshold({
          profile: HCM,
          thresholdSetAt: '2026-05-01T00:00:00Z',
          conditionLogs: [
            { fieldPath: 'profile.hasHCM', previousValue: false, newValue: true, createdAt: '2026-05-02T00:00:00Z' },
          ],
        }),
      ).toBe(true)
    })

    it('not stale: threshold set AFTER the condition change', () => {
      expect(
        computeNeedsThreshold({
          profile: HCM,
          thresholdSetAt: '2026-05-05T00:00:00Z',
          conditionLogs: [
            { fieldPath: 'profile.hasHCM', previousValue: false, newValue: true, createdAt: '2026-05-02T00:00:00Z' },
          ],
        }),
      ).toBe(false)
    })

    it('null profile → false', () => {
      expect(
        computeNeedsThreshold({ profile: null, thresholdSetAt: null, conditionLogs: [] }),
      ).toBe(false)
    })
  })
})
