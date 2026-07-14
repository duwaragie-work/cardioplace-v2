import { AuditExceptionDetectorId } from '../../../generated/prisma/enums.js'
import { ALL_DETECTORS } from './index.js'

/**
 * N7 static-drift guard — ensures the detector registry and the Prisma
 * enum stay in sync. A new detector added to the enum without a class
 * implementation (or vice versa) fails the build here.
 */
describe('ALL_DETECTORS — N7 static-drift guard', () => {
  it('every detector.id matches a value in the AuditExceptionDetectorId enum', () => {
    const enumValues = new Set(Object.values(AuditExceptionDetectorId))
    for (const detector of ALL_DETECTORS) {
      expect(enumValues.has(detector.id)).toBe(true)
    }
  })

  it('no duplicate detector.id — two classes cannot claim the same enum value', () => {
    const seen = new Set<string>()
    for (const detector of ALL_DETECTORS) {
      expect(seen.has(detector.id)).toBe(false)
      seen.add(detector.id)
    }
  })

  it('ALL_DETECTORS covers every enum value — no enum value without an implementation', () => {
    const enumValues = new Set(Object.values(AuditExceptionDetectorId))
    const detectorIds = new Set(ALL_DETECTORS.map((d) => d.id))
    for (const value of enumValues) {
      expect(detectorIds.has(value)).toBe(true)
    }
    expect(ALL_DETECTORS.length).toBe(enumValues.size)
  })

  it('every detector carries a valid defaultSeverity', () => {
    const ALLOWED = new Set(['MEDIUM', 'HIGH', 'CRITICAL'])
    for (const detector of ALL_DETECTORS) {
      expect(ALLOWED.has(detector.defaultSeverity)).toBe(true)
    }
  })
})
