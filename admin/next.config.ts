import path from "node:path";
import type { NextConfig } from "next";

const monorepoRoot = path.resolve(process.cwd(), '..');

// ─── V-12 · Security headers (CSP / X-Frame-Options / nosniff) ──────────────
// Assessment finding: the Next apps emitted HSTS only. Policy is built from what
// THIS app actually loads, so it can be enforced without breaking anything:
//   • API    — every fetch goes to NEXT_PUBLIC_API_URL (connect-src).
//   • blob:  — report/CSV downloads, recovery-code export.
//   • data:  — inline SVG chevrons + the MFA-enrolment QR code (a data: PNG).
// Deliberately tighter than the patient app: no third-party frames or images —
// admin embeds nothing external, so frame-src stays same-origin.
//
// NOTE on script-src 'unsafe-inline': Next's App Router injects inline bootstrap
// + RSC flight scripts. Dropping it needs a per-request nonce, which can't live
// in this static `headers()` block and would force every page dynamic. The
// finding asks for CSP in next.config, so we take the static form — the
// high-value directives (frame-ancestors, connect-src, object-src) still hold.
const isDev = process.env.NODE_ENV !== 'production';
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** ws(s):// origin for a http(s):// URL. */
function wsOrigin(httpUrl: string): string {
  try {
    const u = new URL(httpUrl);
    return `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`;
  } catch {
    return '';
  }
}

const connectSrc = [
  ...new Set(
    [
      "'self'",
      apiUrl,
      wsOrigin(apiUrl),
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
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'self'",
  `connect-src ${connectSrc.join(' ')}`,
].join('; ');

const nextConfig: NextConfig = {
  // B1 — build target is env-toggleable, NOT hard-flipped. Default stays
  // 'standalone' so the current deploy (middleware + headers) keeps working.
  // Only the AWS static build sets STATIC_EXPORT=1 for a pure static bundle.
  output: process.env.STATIC_EXPORT ? 'export' : 'standalone',
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
  transpilePackages: ['@cardioplace/shared'],
  // Next 16 dev blocks cross-origin requests to /_next/* by default — strands
  // Playwright (it connects via 127.0.0.1 even when the URL is localhost).
  // Without this, the HMR + JS bundles get blocked and React never hydrates,
  // so testids never appear. Dev-only relaxation.
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  // HSTS — force HTTPS for returning visitors. Safe to emit on every response
  // without an env gate: browsers only honor HSTS over HTTPS and IGNORE it on
  // http:// and localhost, so local dev and any plain-http deploy are
  // unaffected — it only activates on a real HTTPS response. Mirrors the
  // backend's always-on helmet HSTS. No `preload`; `includeSubDomains` is safe
  // (all prod subdomains are HTTPS).
  async headers() {
    // B4 — under static export (STATIC_EXPORT=1) headers() can't run (no server
    // runtime), so these are supplied by CloudFront instead via a
    // response-headers policy — see docs/CLOUDFRONT_SECURITY_HEADERS.md for the
    // exact set. Returning [] keeps that hand-off explicit and avoids the
    // misleading export-time warning. In standalone / dev they still apply, so
    // V-12 is never dropped before the AWS cutover.
    if (process.env.STATIC_EXPORT) return [];
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
          // frame-ancestors. Nothing may embed the admin console.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Admin URLs carry patient ids — never send them to another origin.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
