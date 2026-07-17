import path from "node:path";
import type { NextConfig } from "next";

const monorepoRoot = path.resolve(process.cwd(), '..');

// ─── V-12 · Security headers (CSP / X-Frame-Options / nosniff) ──────────────
// Assessment finding: the Next apps emitted HSTS only — no CSP, no clickjacking
// or MIME-sniffing protection. Built from what this app ACTUALLY loads, so the
// policy can be enforced (not report-only) without white-screening anything:
//   • YouTube  — Homepage embeds /embed/<id> in an iframe + img.youtube.com
//                thumbnails (frame-src + img-src).
//   • API      — every fetch goes to NEXT_PUBLIC_API_URL (connect-src).
//   • Voice    — the Live session opens a WebSocket (connect-src ws/wss).
//   • blob:    — OCR camera captures, recovery-code downloads, audio.
//   • data:    — inline SVG/PNG (select-chevron, MFA QR).
//   • sw.js    — push service worker (worker-src).
//
// NOTE on script-src 'unsafe-inline': Next's App Router injects inline bootstrap
// + RSC flight scripts. Removing it requires a per-request nonce, which cannot
// live in this static `headers()` block AND would opt every page out of static
// rendering. The finding asks for CSP in next.config, so we take the static
// form. The high-value directives below still hold: frame-ancestors blocks
// clickjacking, and connect-src bounds where PHI could be exfiltrated to.
const isDev = process.env.NODE_ENV !== 'production';
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const voiceWsUrl = process.env.NEXT_PUBLIC_VOICE_WS_URL ?? '';

/** ws(s):// origin for a http(s):// URL — the voice socket rides the API host. */
function wsOrigin(httpUrl: string): string {
  try {
    const u = new URL(httpUrl);
    return `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`;
  } catch {
    return '';
  }
}

// Deduped: the voice socket usually rides the API host, so these overlap.
const connectSrc = [
  ...new Set(
    [
      "'self'",
      apiUrl,
      wsOrigin(apiUrl),
      voiceWsUrl,
      // Dev only: Turbopack/HMR talks over ws to the dev server.
      ...(isDev ? ['ws:', 'wss:'] : []),
    ].filter(Boolean),
  ),
];

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // The real clickjacking control (X-Frame-Options below is the legacy twin).
  "frame-ancestors 'none'",
  "form-action 'self'",
  // 'unsafe-eval' is required by React Refresh in dev only — never in prod.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://img.youtube.com",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'self' https://www.youtube.com",
  `connect-src ${connectSrc.join(' ')}`,
].join('; ');

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
  transpilePackages: ['@cardioplace/shared'],
  // Next 16 dev blocks cross-origin requests to /_next/* by default, which
  // strands Playwright (it connects via 127.0.0.1 even when the URL is
  // localhost) — the HMR + JS bundles get blocked and React never hydrates,
  // so testids never appear. Allow the loopback variants explicitly. This
  // only relaxes the dev server; production builds aren't affected.
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  // HSTS — force HTTPS for returning visitors (closes the SSL-stripping window
  // on the first http:// hit). Safe to emit on every response without any env
  // gate: browsers only honor HSTS over HTTPS and IGNORE it on http:// and
  // localhost — so local dev and any plain-http deploy are unaffected. It only
  // "activates" once a real HTTPS response carries it. This mirrors the
  // backend's always-on helmet HSTS. No `preload` (irreversible);
  // `includeSubDomains` is safe — every Cardioplace prod subdomain is HTTPS.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          // V-12 — see the policy note above.
          { key: 'Content-Security-Policy', value: csp },
          // Legacy clickjacking header for browsers that predate
          // frame-ancestors. Nothing embeds the patient app in an iframe.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Don't leak the full patient-app URL (which can carry ids) to
          // third parties — e.g. the YouTube embed's referrer.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
