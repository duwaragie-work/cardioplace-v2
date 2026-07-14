import { patientConditionLabel } from './conditions';

type ProfileInput = Parameters<typeof patientConditionLabel>[0];

function profile(overrides: Partial<NonNullable<ProfileInput>> = {}): ProfileInput {
  return {
    heartFailureType: 'NOT_APPLICABLE',
    hasHCM: false,
    hasDCM: false,
    hasAorticStenosis: false,
    ...overrides,
  };
}

describe('F30 patientConditionLabel', () => {
  it('labels an aortic-stenosis-only patient (previously rendered empty)', () => {
    expect(patientConditionLabel(profile({ hasAorticStenosis: true }))).toBe('aortic stenosis');
  });

  it('labels HFrEF', () => {
    expect(patientConditionLabel(profile({ heartFailureType: 'HFREF' }))).toBe('HFrEF');
  });

  it('joins multiple mandatory conditions', () => {
    expect(
      patientConditionLabel(profile({ heartFailureType: 'HFREF', hasHCM: true, hasAorticStenosis: true })),
    ).toBe('HFrEF / HCM / aortic stenosis');
  });

  it('falls back to a generic phrase when no flags match', () => {
    expect(patientConditionLabel(profile())).toBe('a monitored condition');
    expect(patientConditionLabel(null)).toBe('a monitored condition');
  });
});
