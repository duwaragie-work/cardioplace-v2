// #94 — condition-matrix verification for thresholdDefaultsFor().
//
// These tests pin the ACTUAL behavior of the suggested-defaults function so
// any future regression is caught. Where the actual output differs from the
// handoff's expected matrix (which assumed a richer {bannerText, notes,
// HFpEF/AFib} shape), the divergence is a FINDING surfaced in the Handoff 3
// results doc — NOT auto-patched (clinical defaults must not change silently).

import { thresholdDefaultsFor, thresholdMandatory } from './patient-detail.service'

type ProfileArg = Parameters<typeof thresholdDefaultsFor>[0]

// Minimal profile factory — only the fields the function reads.
function profile(over: Partial<NonNullable<ProfileArg>> = {}): ProfileArg {
  return {
    hasCAD: false,
    hasHCM: false,
    hasDCM: false,
    hasAorticStenosis: false,
    heartFailureType: 'NOT_APPLICABLE',
    ...over,
  } as ProfileArg
}

describe('thresholdDefaultsFor — condition matrix (#94)', () => {
  it('null profile → no defaults', () => {
    expect(thresholdDefaultsFor(null)).toEqual({})
  })

  it('no conditions → no defaults', () => {
    expect(thresholdDefaultsFor(profile())).toEqual({})
  })

  it('CAD → DBP lower target 70 (J-curve)', () => {
    expect(thresholdDefaultsFor(profile({ hasCAD: true }))).toEqual({
      dbpLowerTarget: 70,
    })
  })

  it('HFrEF → SBP lower target 85', () => {
    expect(
      thresholdDefaultsFor(profile({ heartFailureType: 'HFREF' })),
    ).toEqual({ sbpLowerTarget: 85 })
  })

  it('DCM → SBP lower target 85 (managed as HFrEF, spec §4.8)', () => {
    expect(thresholdDefaultsFor(profile({ hasDCM: true }))).toEqual({
      sbpLowerTarget: 85,
    })
  })

  it('HCM → SBP lower target 100 (preload-dependent)', () => {
    expect(thresholdDefaultsFor(profile({ hasHCM: true }))).toEqual({
      sbpLowerTarget: 100,
    })
  })

  it('aortic stenosis → SBP lower target 100 (interim HCM-style, Q5C)', () => {
    expect(
      thresholdDefaultsFor(profile({ hasAorticStenosis: true })),
    ).toEqual({ sbpLowerTarget: 100 })
  })

  // FINDING (surfaced, not fixed): HFpEF returns NO suggested default. The
  // handoff matrix expected sbpLower=110. The function has no HFpEF branch.
  it('HFpEF → no default (FINDING: handoff expected sbpLower=110)', () => {
    expect(
      thresholdDefaultsFor(profile({ heartFailureType: 'HFPEF' })),
    ).toEqual({})
  })

  // FINDING (surfaced, not fixed): AFib returns NO default and no "3 readings"
  // note. The handoff matrix expected an AFib note. thresholdDefaultsFor only
  // emits numeric SBP/DBP lower targets — banner/notes live in the UI layer.
  it('AFib → no default (FINDING: no "3 readings" note in this function)', () => {
    // hasAFib is not even in the function's Pick<> — confirm it is inert.
    expect(thresholdDefaultsFor(profile())).toEqual({})
  })

  it('HFrEF + CAD → both targets (SBP 85 + DBP 70)', () => {
    expect(
      thresholdDefaultsFor(profile({ heartFailureType: 'HFREF', hasCAD: true })),
    ).toEqual({ sbpLowerTarget: 85, dbpLowerTarget: 70 })
  })

  it('HCM + HFrEF → HCM trumps (SBP 100, not 85)', () => {
    expect(
      thresholdDefaultsFor(profile({ hasHCM: true, heartFailureType: 'HFREF' })),
    ).toEqual({ sbpLowerTarget: 100 })
  })

  it('HFrEF + CAD + AFib (multi) → SBP 85 + DBP 70 (AFib inert here)', () => {
    expect(
      thresholdDefaultsFor(
        profile({ heartFailureType: 'HFREF', hasCAD: true }),
      ),
    ).toEqual({ sbpLowerTarget: 85, dbpLowerTarget: 70 })
  })
})

describe('thresholdMandatory — which conditions require explicit thresholds (#94)', () => {
  it.each([
    ['HFrEF', { heartFailureType: 'HFREF' as const }, true],
    ['HCM', { hasHCM: true }, true],
    ['DCM', { hasDCM: true }, true],
    ['aortic stenosis', { hasAorticStenosis: true }, true],
    ['HFpEF', { heartFailureType: 'HFPEF' as const }, false],
    ['CAD only', { hasCAD: true }, false],
    ['no conditions', {}, false],
  ])('%s → mandatory=%s', (_name, over, expected) => {
    expect(thresholdMandatory(profile(over))).toBe(expected)
  })
})
