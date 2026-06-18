// Bug 25 (2026-06-17) — edit-modal time precision + collision guard.
//
// The readings edit modal uses <input type="time">, which only exposes HH:MM.
// Two pure helpers keep that picker honest:
//   • resolveEditedMeasuredAt — preserve the original seconds/ms when the
//     patient leaves the minute unchanged (so editing the BP of a 01:35:24
//     reading doesn't silently truncate it to 01:35:00 and manufacture a
//     collision with a sibling at :00). Reset to :00 only on an intentional
//     retime (the minute actually moved).
//   • findMeasuredAtCollision — reject a duplicate measuredAt BEFORE the PATCH,
//     using the readings the page already holds in memory, so the patient gets
//     an inline message instead of an opaque backend 409.
//
// Both are framework-free so they can be unit-tested in isolation.

/**
 * Resolve the measuredAt to PATCH from the modal's date + time pickers.
 * `chosenDate` = YYYY-MM-DD, `chosenTime` = HH:MM or HH:MM:SS (local wall-clock;
 * the edit modal's <input type="time" step="1"> yields seconds). Returns a UTC
 * ISO string. When the chosen wall-clock SECOND equals the original entry's
 * second, the original milliseconds are preserved (the picker can't express ms);
 * otherwise the chosen time is used verbatim (ms = 000).
 */
export function resolveEditedMeasuredAt(
  originalISO: string,
  chosenDate: string,
  chosenTime: string,
): string {
  const original = new Date(originalISO);
  // Nothing chosen (caller shouldn't pass this, but be safe) — keep original.
  if (!chosenDate || !chosenTime) {
    return Number.isNaN(original.getTime())
      ? originalISO
      : original.toISOString();
  }
  const chosen = new Date(`${chosenDate}T${chosenTime}`); // local parse
  if (Number.isNaN(chosen.getTime())) {
    return Number.isNaN(original.getTime())
      ? originalISO
      : original.toISOString();
  }
  if (Number.isNaN(original.getTime())) {
    // Original was unparseable — there are no milliseconds to preserve.
    return chosen.toISOString();
  }
  // Same second (HH:MM:SS unchanged) → keep the original instant incl. ms.
  return Math.floor(original.getTime() / 1000) === Math.floor(chosen.getTime() / 1000)
    ? original.toISOString()
    : chosen.toISOString();
}

/**
 * Find an existing reading occupying the exact `finalISO` instant (excluding the
 * one being edited). Compares by epoch ms so ISO formatting differences (with or
 * without milliseconds) don't cause false negatives. Returns the colliding entry
 * or null.
 */
export function findMeasuredAtCollision<
  T extends { id: string; measuredAt: string },
>(entries: T[], finalISO: string, excludeId: string): T | null {
  const target = new Date(finalISO).getTime();
  if (Number.isNaN(target)) return null;
  return (
    entries.find(
      (e) =>
        e.id !== excludeId && new Date(e.measuredAt).getTime() === target,
    ) ?? null
  );
}

/**
 * Bug 23 — "Editable for a few more minutes" badge visibility. Shown only while
 * the engine deferral is set AND still in the future. When the backend nulls
 * engineEvaluationDeferredUntil (a buffer fast-fire commit, admin, or Option D),
 * the badge hides. Pure so it can be unit-tested against a fixed `now`.
 */
export function isEditableBadgeVisible(
  engineEvaluationDeferredUntil: string | null | undefined,
  now: number,
): boolean {
  if (!engineEvaluationDeferredUntil) return false;
  const t = new Date(engineEvaluationDeferredUntil).getTime();
  return !Number.isNaN(t) && t > now;
}
