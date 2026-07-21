// PHI audit 1.8 — read an auth challenge delivered via URL FRAGMENT (`#…`)
// instead of the query string.
//
// After a magic-link email click, the challenge token can't be handed to the
// challenge page via sessionStorage (fresh top-level navigation, no prior JS),
// so the backend redirect carries it in the URL. It USED to use `?query=`, which
// CloudFront/S3 logs verbatim — a short-lived auth challenge sitting in an access
// log. A URL FRAGMENT is never sent to the server (so the static host can't log
// it) and never appears in the Referer header. We read it here and immediately
// scrub it from the address bar so it doesn't linger in browser history either.
export function readChallengeHash(): URLSearchParams | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  if (!params.has('challengeToken')) return null;
  // Scrub the fragment from the URL + this history entry.
  try {
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search,
    );
  } catch {
    /* history unavailable — the fragment was still never logged server-side */
  }
  return params;
}
