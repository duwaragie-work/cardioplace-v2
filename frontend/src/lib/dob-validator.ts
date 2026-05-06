/**
 * Validate a date-of-birth string (YYYY-MM-DD).
 *
 * Returns null when OK, otherwise a user-facing error message. Copy is
 * intentionally friendly + actionable — the patient should always know
 * what to fix and why. Used by both onboarding and the profile editor
 * so the same rules apply everywhere a DOB is set.
 *
 * Empty input is the caller's concern — both onboarding and the profile
 * editor treat DOB as optional and skip the call when the field is blank.
 */
export function validateDateOfBirth(raw: string): string | null {
  const dob = new Date(raw);
  if (Number.isNaN(dob.getTime())) {
    return "That doesn't look like a valid date — please pick from the calendar.";
  }
  const today = new Date();
  const dobDay = new Date(dob.getFullYear(), dob.getMonth(), dob.getDate());
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (dobDay > todayDay) {
    return 'That date is in the future. Please pick the day you were born.';
  }
  if (dobDay.getTime() === todayDay.getTime()) {
    return "Today can't be your date of birth — please pick the day you were born.";
  }
  // 18+ check: compute "18 years ago today" and require dob <= that.
  const eighteenAgo = new Date(
    todayDay.getFullYear() - 18,
    todayDay.getMonth(),
    todayDay.getDate(),
  );
  if (dobDay > eighteenAgo) {
    return 'Cardioplace is for adults 18 and older. Please double-check your date of birth.';
  }
  if (dobDay.getFullYear() < todayDay.getFullYear() - 120) {
    return "That date doesn't look right — please check the year and try again.";
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
