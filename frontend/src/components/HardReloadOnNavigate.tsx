'use client';

import { useEffect } from 'react';

/**
 * Makes in-app link navigation do a FULL page load instead of Next.js's soft
 * client-side transition — the same way a classic multi-page site (e.g.
 * Wikipedia) works.
 *
 * Why: mobile browsers (iOS Safari / Android Chrome) only reset a user's
 * pinch-zoom on a real document load. In a SPA the document never reloads, so a
 * page the patient pinch-zoomed stays zoomed after navigating. There is no JS
 * API to reset the visual-viewport scale; a full load is the only reliable way.
 * Wikipedia gets the zoom-reset "for free" because every navigation is a full
 * load — this reproduces that.
 *
 * How: a capture-phase click listener catches same-origin anchor clicks and
 * routes them through `window.location` so the browser fully reloads (and thus
 * resets zoom). External links, new-tab / download links, modified clicks, and
 * in-page hash links are left untouched.
 *
 * Trade-off: navigations lose the instant SPA feel (a brief reload). Programmatic
 * navigations (router.push in code) are NOT covered — only link clicks.
 */
export default function HardReloadOnNavigate() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Let the browser handle anything already handled, non-left, or modified
      // (new tab / download-intent) clicks.
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }

      const anchor = (e.target as HTMLElement | null)?.closest?.('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;

      // Respect explicit new-tab / download / non-navigating links.
      const target = anchor.getAttribute('target');
      if (target && target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      // External origins (and mailto:/tel:) → leave to the browser.
      if (url.origin !== window.location.origin) return;

      // Same-page hash link (e.g. #section) → in-page jump, no reload wanted.
      if (url.pathname === window.location.pathname && url.hash) return;

      // Force a full document load → browser resets pinch-zoom, like Wikipedia.
      e.preventDefault();
      window.location.assign(url.href);
    }

    // Capture phase so we run before Next's <Link> click handler and can stop
    // its soft navigation before it starts.
    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, []);

  return null;
}
