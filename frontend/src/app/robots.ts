import type { MetadataRoute } from 'next'

/**
 * /robots.txt — Next 16 file convention. Closes B8 from
 * qa/reports/RESULTS.md (was returning text/html via the catch-all). The
 * patient app is the only crawlable surface; admin is HIPAA-positioned and
 * gated behind sign-in, so we explicitly disallow all `/admin/*`-style
 * paths even though the proxy already 302s them away.
 *
 * Sitemap URL is built from NEXT_PUBLIC_PATIENT_BASE_URL when set
 * (production: https://www.cardioplace.ai); otherwise falls back to the
 * local dev origin so the value is always valid.
 */
const BASE_URL =
  process.env.NEXT_PUBLIC_PATIENT_BASE_URL ?? 'http://localhost:3000'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/about', '/privacy', '/terms', '/sign-in'],
        disallow: ['/dashboard', '/admin', '/check-in', '/profile', '/notifications', '/readings', '/chat', '/clinical-intake', '/onboarding', '/auth/'],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
