// V-10 — ePHI draft lifecycle (security remediation, 2026-07-14).
//
// The intake + check-in wizards persist in-progress CLINICAL data (BP readings,
// symptoms, medications, conditions) to Web Storage so a patient who refreshes,
// closes the tab, or taps "Save for later" can resume. Before this module the
// drafts were only removed when a flow COMPLETED — abandon it, or sign out
// mid-flow, and the ePHI stayed on the device for the next person to read.
// That is the kiosk / shared-device risk for the Ward 7/8 pilot.
//
// This module owns two controls:
//   1. purgeClinicalDrafts()      — wipe every draft on sign-out / idle timeout.
//   2. sweepStaleClinicalDrafts() — age out drafts when sign-out never happens
//                                   (crash, tab closed, battery died).
//
// WHY NOT sessionStorage (the other option in the finding): it would break
// documented behaviour. The intake draft is a "Save for later → resume from the
// dashboard's Action Required card" feature, and the check-in draft is meant to
// survive a tab refresh; sessionStorage dies with the tab, silently destroying
// patient work. Purge-on-logout + a bounded max-age closes the same exposure
// without that regression.
//
// SCOPE: matches `cardioplace_*_draft:*` ONLY — the three clinical draft stores.
// Deliberately does NOT touch auth/session keys (cp_*, healplace_*) — logout
// already owns those — nor non-clinical UI prefs.

/** True for the clinical draft keys this module owns: `cardioplace_*_draft:*`. */
function isClinicalDraftKey(key: string): boolean {
  return key.startsWith('cardioplace_') && key.includes('_draft:');
}

/**
 * Max age per draft store, chosen to bound ePHI exposure WITHOUT breaking each
 * flow's intended resume window:
 *  - check-in: a daily reading draft older than a day is worthless (its
 *    measurement time would be wrong anyway).
 *  - intake: "Save for later" is explicitly resumable days later — 7d keeps
 *    that promise while still bounding it.
 *  - buffer: the review window is 5 minutes; it also lives in sessionStorage,
 *    so this is just belt-and-braces.
 */
const MAX_AGE_MS: Array<{ prefix: string; maxAge: number }> = [
  { prefix: 'cardioplace_checkin_draft:', maxAge: 24 * 60 * 60 * 1000 },
  { prefix: 'cardioplace_intake_draft:', maxAge: 7 * 24 * 60 * 60 * 1000 },
  { prefix: 'cardioplace_buffer_draft:', maxAge: 60 * 60 * 1000 },
];
/** Any future `*_draft:` store we haven't classified — fail short, not long. */
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function maxAgeFor(key: string): number {
  return MAX_AGE_MS.find((m) => key.startsWith(m.prefix))?.maxAge ?? DEFAULT_MAX_AGE_MS;
}

/** Both stores — buffer drafts live in sessionStorage, the rest in localStorage. */
function stores(): Storage[] {
  if (typeof window === 'undefined') return [];
  const out: Storage[] = [];
  // Access can throw in private mode / when storage is blocked by policy.
  try {
    out.push(window.localStorage);
  } catch {
    /* unavailable — nothing to purge there */
  }
  try {
    out.push(window.sessionStorage);
  } catch {
    /* unavailable */
  }
  return out;
}

/** Snapshot keys BEFORE mutating — removing while iterating by index skips entries. */
function draftKeys(store: Storage): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && isClinicalDraftKey(key)) keys.push(key);
    }
  } catch {
    /* no-op */
  }
  return keys;
}

/**
 * Remove EVERY clinical draft on this device — all users, not just the one
 * signing out. Intentional: on a shared/kiosk device another patient's
 * abandoned draft is exactly the ePHI we must not leave behind, and a
 * sign-out is the one moment we know the device is being handed over.
 *
 * Safe to call unconditionally; never throws (a failure here must never block
 * sign-out).
 */
export function purgeClinicalDrafts(): void {
  for (const store of stores()) {
    for (const key of draftKeys(store)) {
      try {
        store.removeItem(key);
      } catch {
        /* keep going — best effort */
      }
    }
  }
}

/**
 * Drop drafts older than their store's max age. Covers the case logout can't:
 * the tab was closed or the app crashed, so purgeClinicalDrafts() never ran.
 * Call on app start.
 *
 * A draft whose JSON is unparseable is removed (it can't be resumed anyway).
 * A draft with no recognisable timestamp is KEPT — that's a pre-existing draft
 * written before this module stamped one, and deleting it would silently throw
 * away patient work on the deploy that ships this.
 */
export function sweepStaleClinicalDrafts(now: number = Date.now()): void {
  for (const store of stores()) {
    for (const key of draftKeys(store)) {
      try {
        const raw = store.getItem(key);
        if (raw === null) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          store.removeItem(key); // corrupt → unusable
          continue;
        }
        if (!parsed || typeof parsed !== 'object') {
          store.removeItem(key);
          continue;
        }

        // Each store stamps its own field: check-in `savedAt`, intake
        // `__savedAt`, buffer `createdAt`.
        const rec = parsed as Record<string, unknown>;
        const stamp = [rec.savedAt, rec.__savedAt, rec.createdAt].find(
          (v): v is number => typeof v === 'number' && Number.isFinite(v),
        );
        if (stamp === undefined) continue; // legacy draft — keep

        if (now - stamp > maxAgeFor(key)) store.removeItem(key);
      } catch {
        /* best effort */
      }
    }
  }
}
