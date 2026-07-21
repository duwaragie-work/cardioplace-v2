// V-audit 1.6 — carry the post-activation email prefill via sessionStorage
// instead of a `?email=` query param.
//
// The admin activate flow used to redirect to `/sign-in?activated=1&email=<email>`
// on SIGN_IN_REQUIRED, putting the invitee's email (PII) into the URL — logged
// verbatim by CloudFront/S3 and leaked via history/Referer. The benign
// `activated=1` flag stays in the URL; only the email moves to sessionStorage
// (same-tab, same-origin, never logged).

const KEY = 'cp_signin_prefill_email';

/** Stash the invitee email just before redirecting to /sign-in?activated=1. */
export function stashSignInEmail(email: string): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = email.trim();
    if (trimmed) window.sessionStorage.setItem(KEY, trimmed);
  } catch {
    // sessionStorage blocked — prefill is a convenience, skip it.
  }
}

/** Read + CLEAR the stashed email (one-shot). */
export function takeSignInEmail(): string {
  if (typeof window === 'undefined') return '';
  try {
    const v = window.sessionStorage.getItem(KEY);
    if (v) window.sessionStorage.removeItem(KEY);
    return v ?? '';
  } catch {
    return '';
  }
}
