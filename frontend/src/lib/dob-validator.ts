/** Translation key returned by `validateDateOfBirth`. The caller looks the
 *  key up via `t()` at render time so the message stays in the patient's
 *  current language — including after they switch language post-error. */
export type DobErrorKey =
  | 'dob.errInvalid'
  | 'dob.errFuture'
  | 'dob.errToday'
  | 'dob.errUnder18'
  | 'dob.errAncient';

/**
 * Validate a date-of-birth string (YYYY-MM-DD).
 *
 * Returns null when OK, otherwise a translation key the caller resolves
 * with `t()`. Used by onboarding, profile editor, and clinical-intake A1
 * so the same rules apply wherever a DOB is set.
 *
 * Empty input is the caller's concern — callers gate with `if (raw)`.
 */
export function validateDateOfBirth(raw: string): DobErrorKey | null {
  const dob = new Date(raw);
  if (Number.isNaN(dob.getTime())) {
    return 'dob.errInvalid';
  }
  const today = new Date();
  const dobDay = new Date(dob.getFullYear(), dob.getMonth(), dob.getDate());
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (dobDay > todayDay) {
    return 'dob.errFuture';
  }
  if (dobDay.getTime() === todayDay.getTime()) {
    return 'dob.errToday';
  }
  const eighteenAgo = new Date(
    todayDay.getFullYear() - 18,
    todayDay.getMonth(),
    todayDay.getDate(),
  );
  if (dobDay > eighteenAgo) {
    return 'dob.errUnder18';
  }
  if (dobDay.getFullYear() < todayDay.getFullYear() - 120) {
    return 'dob.errAncient';
  }
  return null;
}

/**
 * Max date-of-birth ISO string (YYYY-MM-DD) — 18 years ago today.
 * Use as the `max=` attribute on a `<input type="date">` so the calendar
 * picker greys out under-18 dates client-side.
 */
export function maxDobIso(): string {
  const t0 = new Date();
  const max = new Date(t0.getFullYear() - 18, t0.getMonth(), t0.getDate());
  return max.toISOString().slice(0, 10);
}
