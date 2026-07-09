'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Resets the browser's pinch-zoom (visual-viewport scale) back to 100% on every
 * client-side navigation. Next.js keeps the same document alive across route
 * changes, so a page the patient pinch-zoomed with their fingers stays zoomed
 * when they move to another page — this snaps it back to the default size.
 *
 * There is no JS API to set the visual-viewport scale, so the only lever is the
 * viewport <meta>: we briefly clamp it to `maximum-scale=1, user-scalable=no`
 * (which forces mobile browsers to snap back to 1×), then restore the original
 * zoom-allowed viewport one tick later. The clamp is *momentary and reverted*,
 * so pinch-zoom stays available WITHIN each page — that's the accessibility
 * intent globals.css guards (never clamp zoom statically for 50+/low-vision
 * patients). Here we only reset BETWEEN pages.
 *
 * iOS Safari honours this reliably; Android Chrome is best-effort.
 */
export default function ResetZoomOnNavigate() {
  const pathname = usePathname();
  const firstRun = useRef(true);
  const originalContent = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;

    // Capture the app's real viewport once so we restore exactly it (and not a
    // hardcoded guess that might drop an attribute Next set).
    if (originalContent.current === null) {
      originalContent.current =
        meta.getAttribute('content') ?? 'width=device-width, initial-scale=1';
    }

    // Don't disturb the very first paint — only reset on an actual navigation.
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }

    const original = originalContent.current;
    // Clamp → forces the browser to snap the visual viewport back to 1×.
    meta.setAttribute(
      'content',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
    );

    // Restore the zoom-allowed viewport on the next tick so pinch-zoom stays
    // usable on the new page. Restoring too fast can stop the reset from taking
    // effect on some browsers, so give it a short beat.
    const id = window.setTimeout(() => {
      meta.setAttribute('content', original);
    }, 300);

    return () => window.clearTimeout(id);
  }, [pathname]);

  return null;
}
