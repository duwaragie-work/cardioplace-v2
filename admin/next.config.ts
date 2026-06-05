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
};

export default nextConfig;
