// V-10 — ePHI draft purge + stale sweep.
//
// These assert a SECURITY control, not a convenience: if the purge silently
// stops matching the draft keys, clinical data survives sign-out on a shared
// device and nothing else in the app would fail. Hence the explicit
// "auth keys are untouched" and "other users' drafts also go" cases.

import { purgeClinicalDrafts, sweepStaleClinicalDrafts } from './clinical-drafts';

const CHECKIN = 'cardioplace_checkin_draft:user-1';
const INTAKE = 'cardioplace_intake_draft:user-1';
const BUFFER = 'cardioplace_buffer_draft:user-1';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('purgeClinicalDrafts', () => {
  it('removes check-in + intake drafts from localStorage', () => {
    window.localStorage.setItem(CHECKIN, JSON.stringify({ form: { systolicBP: 180 }, savedAt: Date.now() }));
    window.localStorage.setItem(INTAKE, JSON.stringify({ medications: ['Lisinopril'] }));

    purgeClinicalDrafts();

    expect(window.localStorage.getItem(CHECKIN)).toBeNull();
    expect(window.localStorage.getItem(INTAKE)).toBeNull();
  });

  it('removes buffer drafts from sessionStorage too', () => {
    window.sessionStorage.setItem(BUFFER, JSON.stringify({ readings: [], createdAt: Date.now() }));

    purgeClinicalDrafts();

    expect(window.sessionStorage.getItem(BUFFER)).toBeNull();
  });

  // Shared/kiosk device: another patient's abandoned draft is exactly the ePHI
  // we must not leave for the next person.
  it('removes EVERY user\'s drafts, not just one', () => {
    window.localStorage.setItem('cardioplace_checkin_draft:user-1', '{"savedAt":1}');
    window.localStorage.setItem('cardioplace_checkin_draft:user-2', '{"savedAt":1}');
    window.localStorage.setItem('cardioplace_intake_draft:user-3', '{}');

    purgeClinicalDrafts();

    expect(window.localStorage.length).toBe(0);
  });

  // A purge that also nuked the session/prefs would break the app.
  it('leaves auth, session and preference keys alone', () => {
    window.localStorage.setItem('healplace_locale', 'am');
    window.localStorage.setItem('healplace_device_id', 'dev-1');
    window.localStorage.setItem('cp_push_optout', '1');
    window.localStorage.setItem('healplace_onboarding_skipped_user-1', 'true');
    window.localStorage.setItem(CHECKIN, '{"savedAt":1}');

    purgeClinicalDrafts();

    expect(window.localStorage.getItem(CHECKIN)).toBeNull();
    expect(window.localStorage.getItem('healplace_locale')).toBe('am');
    expect(window.localStorage.getItem('healplace_device_id')).toBe('dev-1');
    expect(window.localStorage.getItem('cp_push_optout')).toBe('1');
    expect(window.localStorage.getItem('healplace_onboarding_skipped_user-1')).toBe('true');
  });

  it('is safe to call when there is nothing to purge', () => {
    expect(() => purgeClinicalDrafts()).not.toThrow();
  });
});

describe('sweepStaleClinicalDrafts', () => {
  const now = 1_700_000_000_000;

  it('drops a check-in draft older than 24h but keeps a fresh one', () => {
    window.localStorage.setItem('cardioplace_checkin_draft:old', JSON.stringify({ savedAt: now - 25 * HOUR }));
    window.localStorage.setItem('cardioplace_checkin_draft:new', JSON.stringify({ savedAt: now - 1 * HOUR }));

    sweepStaleClinicalDrafts(now);

    expect(window.localStorage.getItem('cardioplace_checkin_draft:old')).toBeNull();
    expect(window.localStorage.getItem('cardioplace_checkin_draft:new')).not.toBeNull();
  });

  // "Save for later" must still be resumable days later — that's the feature.
  it('keeps an intake draft for days, drops it past 7d', () => {
    window.localStorage.setItem('cardioplace_intake_draft:recent', JSON.stringify({ __savedAt: now - 3 * DAY }));
    window.localStorage.setItem('cardioplace_intake_draft:ancient', JSON.stringify({ __savedAt: now - 8 * DAY }));

    sweepStaleClinicalDrafts(now);

    expect(window.localStorage.getItem('cardioplace_intake_draft:recent')).not.toBeNull();
    expect(window.localStorage.getItem('cardioplace_intake_draft:ancient')).toBeNull();
  });

  it('ages out a buffer draft via createdAt', () => {
    window.sessionStorage.setItem('cardioplace_buffer_draft:old', JSON.stringify({ createdAt: now - 2 * HOUR }));

    sweepStaleClinicalDrafts(now);

    expect(window.sessionStorage.getItem('cardioplace_buffer_draft:old')).toBeNull();
  });

  // Drafts written before this shipped have no stamp — deleting them would
  // silently destroy patient work on the deploy that ships this.
  it('keeps a legacy draft that has no timestamp', () => {
    window.localStorage.setItem(INTAKE, JSON.stringify({ medications: ['Lisinopril'] }));

    sweepStaleClinicalDrafts(now);

    expect(window.localStorage.getItem(INTAKE)).not.toBeNull();
  });

  it('removes an unparseable draft', () => {
    window.localStorage.setItem(CHECKIN, 'not-json{{');

    sweepStaleClinicalDrafts(now);

    expect(window.localStorage.getItem(CHECKIN)).toBeNull();
  });

  it('does not touch non-draft keys', () => {
    window.localStorage.setItem('healplace_locale', 'en');

    sweepStaleClinicalDrafts(now);

    expect(window.localStorage.getItem('healplace_locale')).toBe('en');
  });
});
