#!/usr/bin/env node
// N10 (2026-07-13) — i18n key-drift check.
//
// Compares every locale file against en.ts and fails if any key present in
// English is missing from another locale. Runs without frontend Jest (per
// [[feedback_frontend_testing]] — user has declined test infra twice).
//
// Usage: `node frontend/scripts/check-i18n-drift.mjs` — or wire it into a
// pre-commit hook / CI step.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const I18N_DIR = resolve(__dirname, '..', 'src', 'i18n')

const LOCALES = ['en', 'es', 'am', 'fr', 'de']

// Parse a locale file as JS text and extract the string keys via regex — we
// don't need a full TS parser, only the quoted keys.
function keysIn(path) {
  const src = readFileSync(path, 'utf8')
  const keys = new Set()
  // Match `'anything': ` or `"anything": ` at any indentation.
  const re = /['"]([^'"\n]+?)['"]\s*:/g
  let m
  while ((m = re.exec(src)) !== null) {
    keys.add(m[1])
  }
  return keys
}

const perLocale = new Map()
for (const loc of LOCALES) {
  perLocale.set(loc, keysIn(resolve(I18N_DIR, `${loc}.ts`)))
}

const enKeys = perLocale.get('en')
let missing = 0

for (const loc of LOCALES) {
  if (loc === 'en') continue
  const locKeys = perLocale.get(loc)
  const gap = [...enKeys].filter((k) => !locKeys.has(k))
  if (gap.length > 0) {
    console.error(`\n❌ ${loc}.ts is missing ${gap.length} key(s) present in en.ts:`)
    for (const k of gap.slice(0, 10)) console.error(`   - ${k}`)
    if (gap.length > 10) console.error(`   … and ${gap.length - 10} more`)
    missing += gap.length
  }
}

if (missing > 0) {
  console.error(`\n🚫 i18n drift: ${missing} missing key(s) across locales`)
  process.exit(1)
}
console.log(`✅ i18n drift check green — all ${enKeys.size} en.ts keys present in ${LOCALES.length - 1} other locales`)
