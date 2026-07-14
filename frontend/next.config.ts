import path from "node:path";
import type { NextConfig } from "next";

const monorepoRoot = path.resolve(process.cwd(), '..');

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
        ],
      },
    ];
  },
};

export default nextConfig;
