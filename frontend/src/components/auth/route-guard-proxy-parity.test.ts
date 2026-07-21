/**
 * RouteGuard ↔ proxy.ts parity.
 *
 * RouteGuard is the client-side replica of proxy.ts: under `output: 'export'`
 * Next middleware does not run, so the guard is the ONLY gate. Its own header
 * says "Keep this in lockstep with proxy.ts if either changes" — but nothing
 * enforced that, and the two are edited on different branches for different
 * reasons.
 *
 * That drift is not hypothetical. When the support system (#149) merged onto
 * the static-export work (#150/#151), proxy.ts had gained the public `/support`
 * hub and the healthcare legal shells while RouteGuard had not. Neither file
 * conflicted, so the merge was silent — and wiring the guard in gated every one
 * of those public pages behind auth. The signed-out `/support` hub rendered
 * nothing.
 *
 * These assertions compare the two sources directly, so the next divergence
 * fails here instead of in a reviewer's memory.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROXY = join(__dirname, '..', '..', 'proxy.ts')
const GUARD = join(__dirname, 'RouteGuard.tsx')

/**
 * Pull a route list out of a source file. Handles both array literals
 * (`const X = [...]`) and Sets (`const X = new Set([...])`).
 *
 * Comments are stripped first — a route mentioned in prose (and both files
 * carry a lot of prose) must not count as a declared route. Only whole-line
 * `//` comments are removed so a `'http://…'` default stays intact.
 */
function extractRoutes(file: string, name: string): string[] {
  const src = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const match = new RegExp(
    `const\\s+${name}\\s*(?::[^=]+)?=\\s*(?:new Set(?:<[^>]*>)?\\()?\\s*\\[([\\s\\S]*?)\\]`,
  ).exec(src)
  if (!match) {
    throw new Error(`${name} not found in ${file} — did it get renamed?`)
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
}

describe('RouteGuard mirrors proxy.ts', () => {
  // PUBLIC_ROUTES is the one that actually bit us: a route missing from the
  // guard is silently gated in the static export.
  it('PUBLIC_ROUTES are identical', () => {
    expect(extractRoutes(GUARD, 'PUBLIC_ROUTES')).toEqual(
      extractRoutes(PROXY, 'PUBLIC_ROUTES'),
    )
  })

  // Both lists are prefix-matched, so a public `/support` would drag every
  // `/support/*` child public without this carve-out.
  it('PRIVATE_ROUTE_EXCEPTIONS are identical', () => {
    expect(extractRoutes(GUARD, 'PRIVATE_ROUTE_EXCEPTIONS')).toEqual(
      extractRoutes(PROXY, 'PRIVATE_ROUTE_EXCEPTIONS'),
    )
  })

  it('ONBOARDING_GATED_ROUTES are identical', () => {
    expect(extractRoutes(GUARD, 'ONBOARDING_GATED_ROUTES')).toEqual(
      extractRoutes(PROXY, 'ONBOARDING_GATED_ROUTES'),
    )
  })

  // Drift here would send admin-role users to the wrong app (or fail to).
  it('ADMIN_ROLES are identical', () => {
    expect(extractRoutes(GUARD, 'ADMIN_ROLES')).toEqual(
      extractRoutes(PROXY, 'ADMIN_ROLES'),
    )
  })

  // Guard against the extractor silently matching nothing and comparing [] to
  // [] — a parity test that passes vacuously is worse than no test.
  it('the extractor actually finds routes (not vacuously equal)', () => {
    expect(extractRoutes(GUARD, 'PUBLIC_ROUTES').length).toBeGreaterThan(10)
    expect(extractRoutes(GUARD, 'PUBLIC_ROUTES')).toContain('/support')
    expect(extractRoutes(GUARD, 'PRIVATE_ROUTE_EXCEPTIONS')).toEqual([
      '/support/my-tickets',
    ])
  })
})
