import type { MetadataRoute } from 'next'

/**
 * /sitemap.xml — Next 16 file convention. Closes B9 from
 * qa/reports/RESULTS.md (was returning text/html via the catch-all). Lists
 * only the public marketing surface — gated paths are excluded by both this
 * sitemap and the robots.ts disallow rules.
 */
const BASE_URL =
  process.env.NEXT_PUBLIC_PATIENT_BASE_URL ?? 'http://localhost:3000'

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return [
    { url: `${BASE_URL}/`, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE_URL}/about`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    // The public half of the adaptive support hub (Help Center, "I can't sign
    // in", general contact) is genuinely public marketing-adjacent surface.
    { url: `${BASE_URL}/support`, lastModified, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE_URL}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${BASE_URL}/terms`, lastModified, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${BASE_URL}/sign-in`, lastModified, changeFrequency: 'yearly', priority: 0.5 },
  ]
}
