// F1 (static export) — in-app navigation id hand-off.
//
// Under `output: 'export'`, an in-app `router.push('/patients/detail?id=<ULID>')`
// makes Next fetch the RSC payload `/patients/detail.txt?id=<ULID>&_rsc=…` from
// the host — so the patient/alert ULID lands in the CDN access log on EVERY
// click. Fix: in-app clicks stash the id in sessionStorage and navigate to the
// BARE route (no query); the shell reads it on mount. A `?id=` fallback is kept
// on the shell so external email/push deep-links still resolve.
//
// The value is left in storage (not consumed): a later nav overwrites it, so a
// same-tab refresh of the bare route still finds it. sessionStorage is per-tab
// and cleared on tab close — and it's never sent to the host, so it never logs.

export type NavHandoff = { id: string; alert?: string };

const PREFIX = 'cp_nav:';

/** Fired after a stash so a shell already mounted on the SAME bare route (e.g.
 *  the global NotificationBell → a different patient while on a detail page —
 *  a same-URL push that wouldn't remount) can re-read and update. */
export const NAV_HANDOFF_EVENT = 'cp:nav-handoff';

export function stashNavId(key: string, payload: NavHandoff): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(payload));
  } catch {
    /* private mode / quota — the ?id= fallback still works */
  }
  try {
    window.dispatchEvent(new CustomEvent(NAV_HANDOFF_EVENT, { detail: { key } }));
  } catch {
    /* CustomEvent unavailable — cross-route navs still work via the mount read */
  }
}

export function readNavId(key: string): NavHandoff | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NavHandoff;
    return parsed && typeof parsed.id === 'string' ? parsed : null;
  } catch {
    return null;
  }
}
