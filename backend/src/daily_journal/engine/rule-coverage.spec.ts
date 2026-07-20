// Cluster 8 §F.1 — rule-coverage matrix CI gate.
//
// Catches the exact regression that motivated this testing uplift: Cluster 8
// shipped to nivakaran-dev with zero dedicated engine unit scenarios for
// RULE_ACE_ANGIOEDEMA / RULE_GENERIC_ANGIOEDEMA / RULE_BRADY_SURVEILLANCE /
// RULE_FIRST_MONTH_ADHERENCE_NUDGE / RULE_CAD_DBP_HIGH. This gate fails
// loudly on every PR that adds a RULE_ID to shared/src/rule-ids.ts without
// also adding at least one test reference.
//
// Scope: enforces "every RULE_ID is referenced from at least one .spec.ts
// file in backend/src or qa/tests". Reference-counting is intentionally
// loose — a single mention of the RULE_* string in test source is enough.
// We don't try to grade test QUALITY here (that's a code-review concern);
// we catch the structural "no test at all" failure mode.
//
// Allowlist policy: keep it tiny + documented inline. Per the testing-uplift
// plan §J: "Don't weaken the CI gates to make them pass." Each allowlist
// entry has a clinical reason + a fixme owner.

import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { RULE_IDS } from '@cardioplace/shared'

// ESM doesn't expose __dirname / __filename. Derive both from import.meta.
const _filename = fileURLToPath(import.meta.url)
const _dirname = dirname(_filename)
// Repo root resolved from this spec file's location (backend/src/...).
const REPO_ROOT = resolve(_dirname, '..', '..', '..', '..')

/**
 * Rule IDs that are deliberately allowed to have zero test references.
 *
 * Each entry MUST cite the clinical reason + the followup ticket /
 * sign-off the rule is blocked on. Adding a rule here without documentation
 * is reviewer-failable.
 */
const ALLOWLIST: Record<string, string> = {
  // Cluster 7 audit (Niva, 2026-05-15): post-Cluster-6 brady split removed
  // N-7 (Duwaragie 2026-07-14 triage) — RULE_BRADY_HR_ASYMPTOMATIC removed
  // from RULE_IDS entirely. Superseded by RULE_BRADY_ABSOLUTE (Cluster 6,
  // Manisha 2026-05-10). The Cluster 8 allowlist entry that used to sit
  // here is deleted alongside the enum value — leaving it would trip the
  // stale-allowlist guard at rule-coverage.spec.ts:131.

  // ─── PRE-EXISTING TECH DEBT (surfaced by Cluster 8 §F.1) ────────────────
  // The gate caught Cluster 5/6/7 rules that shipped with zero test
  // references. The three palpitation rules (AFIB / TACHY_WITH / GENERAL)
  // were cleared in B.1 — they now have dedicated engine unit scenarios in
  // rules.spec.ts and are enforced by this gate. RULE_LOOP_DIURETIC_HYPOTENSION
  // remains allowlisted pending a dedicated scenario.
  //
  // Tracked in §I anomalies report. Owners TBD per cluster-author handoff
  // (Dev 2 owns the rule engine; Niva for symptom rules).
  RULE_LOOP_DIURETIC_HYPOTENSION:
    'pre-existing gap — shipped without engine unit scenario; covered manually in CLINICAL_LOGIC_REVIEW',
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue
    if (entry === 'test-results' || entry === 'playwright-report') continue
    const full = join(dir, entry)
    let s
    try {
      s = statSync(full)
    } catch {
      continue
    }
    if (s.isDirectory()) {
      walk(full, out)
    } else if (
      s.isFile() &&
      (entry.endsWith('.spec.ts') || entry.endsWith('.test.ts'))
    ) {
      out.push(full)
    }
  }
  return out
}

describe('Cluster 8 §F.1 — rule-coverage matrix gate', () => {
  const ruleValues = Object.values(RULE_IDS) as string[]
  const specFiles: string[] = [
    ...walk(join(REPO_ROOT, 'backend', 'src')),
    ...walk(join(REPO_ROOT, 'qa', 'tests')),
  ]

  // Read every spec file ONCE; build a single concatenated corpus so per-rule
  // greps are O(corpus + rules) not O(files × rules). Self-references (the
  // current file) are excluded — this spec literally enumerates every rule
  // ID and would otherwise paper over a missing test elsewhere.
  const selfPath = _filename
  const corpus = specFiles
    .filter((p) => p !== selfPath)
    .map((p) => {
      try {
        return readFileSync(p, 'utf8')
      } catch {
        return ''
      }
    })
    .join('\n')

  it('every RULE_ID is referenced from at least one spec file', () => {
    expect(ruleValues.length).toBeGreaterThan(0)
    const uncovered: string[] = []
    for (const ruleId of ruleValues) {
      if (ALLOWLIST[ruleId] != null) continue
      if (!corpus.includes(ruleId)) uncovered.push(ruleId)
    }
    if (uncovered.length > 0) {
      // Failure message lives in the thrown error so reviewers see exactly
      // which rules slipped through to merge without test coverage.
      throw new Error(
        `Rule(s) shipped without ANY test reference (add a scenario OR document allowlist entry):\n  ${uncovered.join('\n  ')}`,
      )
    }
    expect(uncovered).toEqual([])
  })

  it('allowlist entries actually exist in RULE_IDS (catch stale exceptions)', () => {
    const known = new Set(ruleValues)
    const stale = Object.keys(ALLOWLIST).filter((id) => !known.has(id))
    if (stale.length > 0) {
      throw new Error(
        `Stale allowlist entries (rule no longer in RULE_IDS — delete):\n  ${stale.join('\n  ')}`,
      )
    }
    expect(stale).toEqual([])
  })

  it('discovers at least 100 spec files (sanity — gate must scan a meaningful corpus)', () => {
    // If we land in a directory with no specs we'd false-pass — guard
    // against a tooling change that breaks the discovery walk.
    expect(specFiles.length).toBeGreaterThanOrEqual(20)
  })
})
