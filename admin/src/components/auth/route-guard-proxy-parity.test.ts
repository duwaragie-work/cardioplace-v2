/**
 * Admin RouteGuard ↔ proxy.ts parity — the admin-app half of the same contract
 * the patient app enforces (see frontend/src/components/auth/…parity.test.ts).
 *
 * Under `output: 'export'` Next middleware does not run, so RouteGuard is the
 * only gate and must stay in lockstep with proxy.ts. The two lists agree today;
 * this keeps them agreeing. A route added to proxy.ts but not the guard is
 * silently gated in the static export; one added to the guard but not proxy.ts
 * is silently exposed in the server build.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROXY = join(__dirname, '..', '..', 'proxy.ts')
const GUARD = join(__dirname, 'RouteGuard.tsx')

/** Handles `const X = [...]` and `const X = new Set<T>([...])`. Comments are
 *  stripped so a route named in prose does not count as declared; only
 *  whole-line `//` comments go, so `'http://…'` defaults survive. */
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

describe('admin RouteGuard mirrors proxy.ts', () => {
  it('PUBLIC_PATHS are identical', () => {
    expect(extractRoutes(GUARD, 'PUBLIC_PATHS')).toEqual(
      extractRoutes(PROXY, 'PUBLIC_PATHS'),
    )
  })

  it('ADMIN_ROLES are identical', () => {
    expect(extractRoutes(GUARD, 'ADMIN_ROLES')).toEqual(
      extractRoutes(PROXY, 'ADMIN_ROLES'),
    )
  })

  it('COORDINATOR_BROADER_ROLES are identical', () => {
    expect(extractRoutes(GUARD, 'COORDINATOR_BROADER_ROLES')).toEqual(
      extractRoutes(PROXY, 'COORDINATOR_BROADER_ROLES'),
    )
  })

  // A parity test that passes vacuously is worse than no test.
  it('the extractor actually finds routes (not vacuously equal)', () => {
    expect(extractRoutes(GUARD, 'PUBLIC_PATHS').length).toBeGreaterThan(3)
    expect(extractRoutes(GUARD, 'PUBLIC_PATHS')).toContain('/sign-in')
  })
})
