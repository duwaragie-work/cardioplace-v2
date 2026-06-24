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
