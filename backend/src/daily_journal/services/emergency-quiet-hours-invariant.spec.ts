// Gap 3 fix (2026-07-13) — architectural invariant: emergency dispatch paths
// MUST NEVER consult the daily-reminder quiet-hours helper. Spec §N6:
//
//   NEVER SUPPRESSES (safety-critical — get this wrong and someone gets hurt):
//     • RULE_ABSOLUTE_EMERGENCY
//     • RULE_ACE_ANGIOEDEMA
//     • RULE_GENERIC_ANGIOEDEMA
//     • BP Level 2 alerts
//     • any Tier 1 alert
//
// The dispatch fan-out for those tiers lives in EscalationService; the rule
// producers live under `daily_journal/engine/`. If any of them starts calling
// `isWithinQuietHours` (or importing from the daily-reminder helpers module)
// a patient-local quiet window could silence a safety-critical page — the
// exact clinical harm the spec calls out.
//
// This is a MACHINE-CHECKABLE half of the invariant. The full behavioural
// coverage that emergency alerts do dispatch (regardless of clock time) lives
// in escalation.service.spec.ts — the "Tier 1 after-hours" and "BP L2 at any
// time" describes.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Repo-root-relative paths — every entry MUST route emergency events without
// consulting patient-side quiet-hours preferences.
const EMERGENCY_PATH_FILES = [
  'src/daily_journal/services/escalation.service.ts',
  'src/daily_journal/engine/absolute-emergency.ts',
  'src/daily_journal/engine/angioedema.ts',
] as const

// The helpers module that owns the quiet-hours predicate; importing anything
// from it into an emergency path is the code-smell we're guarding against.
const DAILY_REMINDER_HELPERS_MATCH = /from ['"].*daily-reminder\/helpers/

describe('Gap 3 invariant — emergency paths never consult quiet-hours', () => {
  it.each(EMERGENCY_PATH_FILES)(
    '%s does not reference isWithinQuietHours',
    (relPath) => {
      const src = readFileSync(join(process.cwd(), relPath), 'utf8')
      expect(src).not.toMatch(/\bisWithinQuietHours\b/)
    },
  )

  it.each(EMERGENCY_PATH_FILES)(
    '%s does not import from backend/src/crons/daily-reminder/helpers',
    (relPath) => {
      const src = readFileSync(join(process.cwd(), relPath), 'utf8')
      expect(src).not.toMatch(DAILY_REMINDER_HELPERS_MATCH)
    },
  )

  it('escalation.service.ts still exists and is non-empty (guard against test drift)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/daily_journal/services/escalation.service.ts'),
      'utf8',
    )
    // Sanity — if the file gets renamed and this spec silently passes an empty
    // string, we'd lose the invariant. Match on a load-bearing symbol.
    expect(src).toMatch(/EscalationService/)
    expect(src.length).toBeGreaterThan(1000)
  })
})
