// Phase/5 co-located spec for shared/src/derivatives.ts. Lives in the backend
// so it runs under the existing Jest config; shared/ ships type-only.

import {
  getAgeGroup,
  getBMI,
  getPulsePressure,
  getReadingContext,
} from '@cardioplace/shared'

describe('getPulsePressure (A.1)', () => {
  it('basic 160-80 = 80', () => {
    expect(getPulsePressure(160, 80)).toBe(80)
  })
  it('null inputs → null', () => {
    expect(getPulsePressure(null, 80)).toBeNull()
    expect(getPulsePressure(160, null)).toBeNull()
  })
  it('SBP<DBP (sensor error) → null', () => {
    expect(getPulsePressure(80, 90)).toBeNull()
  })
})

describe('getBMI (A.2)', () => {
  it('170cm / 70kg ≈ 24.2', () => {
    const bmi = getBMI(170, 70)
    expect(bmi).not.toBeNull()
    expect(bmi!).toBeCloseTo(24.22, 1)
  })
  it('missing inputs → null', () => {
    expect(getBMI(null, 70)).toBeNull()
    expect(getBMI(170, null)).toBeNull()
  })
  it('Decimal-like weight → parses', () => {
    const bmi = getBMI(170, { toString: () => '70' })
    expect(bmi).not.toBeNull()
  })
})

describe('getAgeGroup (A.3)', () => {
  const now = new Date('2026-04-22T00:00:00Z')
  it('age 25 → 18-39', () => {
    expect(getAgeGroup(new Date('2000-04-22'), now)).toBe('18-39')
  })
  it('age 50 → 40-64', () => {
    expect(getAgeGroup(new Date('1975-04-22'), now)).toBe('40-64')
  })
  it('age 70 → 65+', () => {
    expect(getAgeGroup(new Date('1955-04-22'), now)).toBe('65+')
  })
  it('null dob → null', () => {
    expect(getAgeGroup(null, now)).toBeNull()
  })
  it('future dob → null', () => {
    expect(getAgeGroup(new Date('2030-04-22'), now)).toBeNull()
  })
  it('age <18 → null', () => {
    expect(getAgeGroup(new Date('2020-04-22'), now)).toBeNull()
  })
  it('exactly 40th birthday → 40-64 (boundary)', () => {
    expect(getAgeGroup(new Date('1986-04-22'), now)).toBe('40-64')
  })
  it('exactly 65th birthday → 65+ (boundary)', () => {
    expect(getAgeGroup(new Date('1961-04-22'), now)).toBe('65+')
  })
})

describe('getReadingContext (A.4)', () => {
  it('08:00 UTC → MORNING', () => {
    expect(getReadingContext(new Date('2026-04-22T08:00:00Z'))).toBe('MORNING')
  })
  it('14:00 UTC → AFTERNOON', () => {
    expect(getReadingContext(new Date('2026-04-22T14:00:00Z'))).toBe(
      'AFTERNOON',
    )
  })
  it('19:00 UTC → EVENING', () => {
    expect(getReadingContext(new Date('2026-04-22T19:00:00Z'))).toBe('EVENING')
  })
  it('02:00 UTC → NOCTURNAL', () => {
    expect(getReadingContext(new Date('2026-04-22T02:00:00Z'))).toBe(
      'NOCTURNAL',
    )
  })
  it('UTC + America/New_York shifts 14:00 UTC → 10:00 local = MORNING', () => {
    expect(
      getReadingContext(
        new Date('2026-04-22T14:00:00Z'),
        'America/New_York',
      ),
    ).toBe('MORNING')
  })
  it('invalid timezone falls back to UTC', () => {
    expect(
      getReadingContext(new Date('2026-04-22T08:00:00Z'), 'Not/ATimezone'),
    ).toBe('MORNING')
  })
})
