// Root postinstall — build @cardioplace/shared so a clean checkout works.
//
// The backend imports `@cardioplace/shared`, which npm resolves through the
// package's `exports`/`types` → `shared/dist`. On a fresh clone that directory
// does not exist yet, so `make install && make dev` failed to compile with
// "Module '@cardioplace/shared' has no exported member ...". There was no
// postinstall hook, so every new dev hit it.
//
// Why this is a script and not just `"postinstall": "npm run build:shared"`:
// backend/Dockerfile and frontend/Dockerfile both run `npm ci` BEFORE they
// `COPY shared ./shared` (they copy only the package.json manifests first, to
// keep the dependency layer cacheable). An unconditional postinstall would run
// `tsc` against a shared/ that has no sources or tsconfig and fail the image
// build. So: build when the source is actually there, skip quietly when it is
// not. CI is unaffected either way — it also runs `npm run build:shared`
// explicitly, and a second tsc pass over an up-to-date dist is a no-op.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tsconfig = join(root, 'shared', 'tsconfig.json')

if (!existsSync(tsconfig)) {
  console.log('[postinstall] shared/ sources not present — skipping build:shared')
  process.exit(0)
}

const result = spawnSync('npm', ['run', 'build:shared'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
})
process.exit(result.status ?? 1)
