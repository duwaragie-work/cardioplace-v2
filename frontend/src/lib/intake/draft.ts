// localStorage persistence for the Clinical Intake wizard so a patient who
// taps "Save for later" — or just closes the tab — can resume from the
// dashboard's Action Required card.
//
// Key is per-user so two patients sharing a device don't collide.

import { EMPTY_INTAKE_STATE, type IntakeFormState, type IntakeStepKey } from './types';

const KEY_PREFIX = 'cardioplace_intake_draft:';

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function loadDraft(userId: string): IntakeFormState | null {
  if (typeof window === 'undefined' || !userId) return null;
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IntakeFormState;
    if (!parsed || typeof parsed !== 'object') return null;
    return { ...EMPTY_INTAKE_STATE, ...parsed };
  } catch {
    return null;
  }
}

export function saveDraft(userId: string, state: IntakeFormState): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify(state));
  } catch {
    // quota / private mode — silently no-op
  }
}

export function clearDraft(userId: string): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.removeItem(keyFor(userId));
  } catch {
    // no-op
  }
}

export function hasDraft(userId: string): boolean {
  if (typeof window === 'undefined' || !userId) return false;
  try {
    return window.localStorage.getItem(keyFor(userId)) !== null;
  } catch {
    return false;
  }
}

/** Step ordering used to render "Step X of N" hints + the Resume CTA. */
export const STEP_ORDER: IntakeStepKey[] = [
  'A0b',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'A8',
  'A9',
  'A10',
  'A11',
];

export function stepProgress(step: IntakeStepKey | undefined): {
  index: number;
  total: number;
} {
  const total = STEP_ORDER.length - 2; // exclude A0b intro + A11 complete from "of N"
  const i = step ? STEP_ORDER.indexOf(step) : 0;
  // Clamp index to the visible range (1..total)
  const adjusted = Math.max(1, Math.min(total, i));
  return { index: adjusted, total };
}
