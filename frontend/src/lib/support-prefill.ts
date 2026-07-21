// V-audit 1.5 — carry the "locked out" support-form email prefill via
// sessionStorage instead of a `?email=` query param.
//
// The sign-in page's reactivation CTA used to link to
// `/support/locked-out?email=<patientEmail>`, putting PII into the URL — which
// CloudFront/S3 log verbatim, and which leaks via history + Referer. The email
// isn't a credential, but on the static-hosting migration it must not reach the
// hosting layer at all. sessionStorage is same-tab, same-origin, never logged.

const KEY = 'cp_support_prefill_email';

/** Stash the typed email just before navigating to /support/locked-out. */
export function stashSupportEmail(email: string): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = email.trim();
    if (trimmed) window.sessionStorage.setItem(KEY, trimmed);
  } catch {
    // sessionStorage blocked (private mode) — prefill is a convenience, skip it.
  }
}

/** Read + CLEAR the stashed email (one-shot, so a later manual visit is blank). */
export function takeSupportEmail(): string {
  if (typeof window === 'undefined') return '';
  try {
    const v = window.sessionStorage.getItem(KEY);
    if (v) window.sessionStorage.removeItem(KEY);
    return v ?? '';
  } catch {
    return '';
  }
}
