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
};

export default nextConfig;
