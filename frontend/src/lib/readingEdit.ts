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

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local wall-clock minute key (YYYY-MM-DDTHH:MM) for a Date — the same basis
 *  the edit modal's date + time pickers are populated from in openEdit(). */
function localMinuteKey(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Resolve the measuredAt to PATCH from the modal's date + time pickers.
 * `chosenDate` = YYYY-MM-DD, `chosenTime` = HH:MM (both local wall-clock).
 * Returns a UTC ISO string. When the chosen minute equals the original entry's
 * minute, the original seconds/ms are preserved; otherwise the seconds reset to
 * :00 (an intentional minute change).
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
  const chosenMinuteKey = `${chosenDate}T${chosenTime}`;
  if (Number.isNaN(original.getTime())) {
    // Original was unparseable — there are no seconds to preserve.
    return new Date(chosenMinuteKey).toISOString();
  }
  return chosenMinuteKey === localMinuteKey(original)
    ? original.toISOString() // minute unchanged → keep original seconds/ms
    : new Date(chosenMinuteKey).toISOString(); // minute changed → :00
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
 * Has-seconds test — drives the edit modal's "recorded at HH:MM:SS, seconds
 * kept" hint. True when the reading carries sub-minute precision the HH:MM
 * picker can't show.
 */
export function hasSubMinutePrecision(iso: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getSeconds() !== 0 || d.getMilliseconds() !== 0;
}

/** Local HH:MM:SS for the original-time hint. */
export function localTimeWithSeconds(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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
