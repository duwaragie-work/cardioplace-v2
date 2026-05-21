// localStorage persistence for the daily Check-in wizard so a patient who
// refreshes the tab or navigates away mid-flow can resume instead of losing
// everything they typed. Mirrors lib/intake/draft.ts, but for the single
// (not-yet-submitted) reading in progress.
//
// The draft is generic over the form shape so this module stays decoupled
// from CheckIn.tsx — the component supplies its FormData type at the call
// site. Key is per-user so two patients sharing a device never collide.

const KEY_PREFIX = 'cardioplace_checkin_draft:';

export interface CheckInDraft<TForm = unknown> {
  /** The in-progress form (typed by the caller). */
  form: TForm;
  /** Wizard step the patient was on when the draft was written. */
  step: string;
  /** Epoch ms of the last write — surfaced in the resume prompt if needed. */
  savedAt: number;
}

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function loadCheckInDraft<TForm = unknown>(
  userId: string,
): CheckInDraft<TForm> | null {
  if (typeof window === 'undefined' || !userId) return null;
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CheckInDraft<TForm>;
    if (!parsed || typeof parsed !== 'object' || !parsed.form) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCheckInDraft<TForm = unknown>(
  userId: string,
  draft: CheckInDraft<TForm>,
): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify(draft));
  } catch {
    // quota exceeded / private mode — silently no-op
  }
}

export function clearCheckInDraft(userId: string): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.removeItem(keyFor(userId));
  } catch {
    // no-op
  }
}
