import { SUPPORTED_LOCALES, getTranslation } from './index';

// F2 — the YOUR GOAL tolerance copy used an em-dash that read as a stray hyphen.
// It is now a comma-joined clause; guard against the em-dash creeping back across locales.
describe('F2 dashboard.goalTolerance copy', () => {
  it('English copy joins the clause with a comma, not an em-dash', () => {
    const en = getTranslation('en', 'dashboard.goalTolerance');
    expect(en).toBe('High alerts begin at {value}, your goal plus a small tolerance.');
    expect(en).not.toContain('—');
  });

  it('no supported locale uses an em-dash in the tolerance copy', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(getTranslation(locale, 'dashboard.goalTolerance')).not.toContain('—');
    }
  });
});
