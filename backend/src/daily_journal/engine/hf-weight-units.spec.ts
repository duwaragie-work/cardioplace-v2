import { hfDecompensationRule } from './condition-branches.js'
import { kgDeltaToLbs } from '../../common/units.js'
import type { SessionAverage, SessionSymptoms } from './types.js'
import type { ResolvedContext } from '@cardioplace/shared'

/**
 * Regression spec for the HF-decompensation WEIGHT arm — the one arm of the
 * rule that had no test at all, which is exactly why the unit bug survived.
 *
 * THE BUG (fixed 2026-07-14): `JournalEntry.weight` is stored in KILOGRAMS (the
 * browser converts lbs→kg before POSTing). The rule computed a kg delta and
 * compared it straight against `HF_WEIGHT_DELTA_LBS = 2`. So it fired at 2 kg =
 * 4.41 lbs — 2.2x LESS sensitive than the signed-off clinical spec (">2 lbs in
 * 24h", HF-ARC 2024) — and wrote the kg figure into the physician-facing audit
 * string labelled "lbs".
 *
 * Every weight below is written in kg with its lbs equivalent in the comment,
 * because the whole class of bug is people reading a number without its unit.
 */

const FIXED_NOW = new Date('2026-04-22T12:00:00Z')
const TWENTY_THREE_HOURS_AGO = new Date('2026-04-21T13:00:00Z')
const TWENTY_FIVE_HOURS_AGO = new Date('2026-04-21T11:00:00Z')

function noSymptoms(): SessionSymptoms {
  return {
    severeHeadache: false, visualChanges: false, alteredMentalStatus: false,
    chestPainOrDyspnea: false, focalNeuroDeficit: false, severeEpigastricPain: false,
    newOnsetHeadache: false, ruqPain: false, edema: false,
    dizziness: false, syncope: false, palpitations: false, legSwelling: false,
    fatigue: false, shortnessOfBreath: false, dryCough: false, nsaidUse: false,
    faceSwelling: false, throatTightness: false, otherSymptoms: [],
  }
}

function session(over: Partial<SessionAverage> = {}): SessionAverage {
  return {
    entryId: 'entry-1', userId: 'user-1', measuredAt: FIXED_NOW,
    systolicBP: 125, diastolicBP: 75, pulse: 72, weight: null,
    readingCount: 2, symptoms: noSymptoms(), suboptimalMeasurement: false,
    sessionId: null, medicationTaken: null, missedMedications: [],
    singleReadingFinalized: false,
    ...over,
  } as SessionAverage
}

/** An HF patient — the rule no-ops for anyone else. */
function hfCtx(): ResolvedContext {
  return {
    userId: 'user-1',
    profile: { hasHeartFailure: true, hasDCM: false, resolvedHFType: 'HFREF' },
    contextMeds: [],
  } as unknown as ResolvedContext
}

/** Gained `gainLbs` pounds since a reading `at` — expressed in the kg the DB holds. */
function gained(gainLbs: number, at: Date = TWENTY_THREE_HOURS_AGO): SessionAverage {
  const priorKg = 80 // ~176.4 lbs
  const gainKg = gainLbs * 0.45359237
  return session({
    weight: priorKg + gainKg,
    priorWeight: priorKg,
    priorWeightAt: at,
  } as Partial<SessionAverage>)
}

describe('kgDeltaToLbs', () => {
  it('preserves the sign of a LOSS — the reason kgToLbs cannot be used on a delta', () => {
    // kgToLbs returns 0 for any non-positive input, which would erase a loss.
    expect(kgDeltaToLbs(-3)).toBeCloseTo(-6.6, 1)
    expect(kgDeltaToLbs(0)).toBe(0)
  })

  it('converts a 2 kg gain to 4.4 lbs — the magnitude of the old bug', () => {
    expect(kgDeltaToLbs(2)).toBeCloseTo(4.4, 1)
  })
})

describe('hfDecompensationRule — weight arm units', () => {
  it('FIRES on a 3 lb gain in 24h (the case the kg/lbs bug used to MISS)', () => {
    // 3 lbs = 1.36 kg. Under the old code: 1.36 > 2 is false → no alert, even
    // though the clinical spec says >2 lbs must fire. This is the regression.
    const result = hfDecompensationRule(gained(3), hfCtx())
    expect(result).not.toBeNull()
    expect(result?.ruleId).toBe('RULE_HF_DECOMPENSATION')
  })

  it('does NOT fire on a 1.5 lb gain — below the 2 lb spec threshold', () => {
    expect(hfDecompensationRule(gained(1.5), hfCtx())).toBeNull()
  })

  it('fires on a 5 lb gain', () => {
    expect(hfDecompensationRule(gained(5), hfCtx())).not.toBeNull()
  })

  it('does NOT fire on weight LOSS, however large', () => {
    // Guards the kgToLbs-on-a-delta trap: if the sign were erased, a 5 lb loss
    // would read as 0 (no fire, correct by luck) — but a naive abs() would fire.
    expect(hfDecompensationRule(gained(-5), hfCtx())).toBeNull()
  })

  it('does NOT fire when the prior weight is older than 24h', () => {
    expect(hfDecompensationRule(gained(5, TWENTY_FIVE_HOURS_AGO), hfCtx())).toBeNull()
  })

  it('reports the gain to the physician in POUNDS, matching the "lbs" label', () => {
    // The old string printed the kg number next to an "lbs" suffix: a 5 lb
    // (2.27 kg) gain was documented to the clinician as "weight-+2.3lbs/24h".
    const result = hfDecompensationRule(gained(5), hfCtx())
    expect(result?.reason).toMatch(/weight-\+5\.0lbs\/24h/)
    expect(result?.reason).not.toMatch(/weight-\+2\.[0-9]lbs/)
  })

  it('no-ops for a non-HF patient regardless of weight gain', () => {
    const nonHf = {
      userId: 'user-1',
      profile: { hasHeartFailure: false, hasDCM: false, resolvedHFType: 'NOT_APPLICABLE' },
      contextMeds: [],
    } as unknown as ResolvedContext
    expect(hfDecompensationRule(gained(10), nonHf)).toBeNull()
  })
})
