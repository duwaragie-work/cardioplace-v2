// B.3 — drift guard between the backend ladder definitions (the source of
// truth for what the cron actually fires) and the shared display contract
// (@cardioplace/shared LADDER_STEP_CODES) that the admin timeline renders.
//
// If a step is added, removed, or reordered on EITHER side without updating
// the other, this fails CI — instead of the admin silently rendering a
// phantom "Not yet triggered" rung that the backend never fires.

import { LADDER_STEP_CODES } from '@cardioplace/shared'
import {
  TIER_1_LADDER,
  TIER_1_ANGIOEDEMA_LADDER,
  TIER_2_LADDER,
  BP_LEVEL_1_LADDER,
  BP_LEVEL_2_LADDER,
  BP_LEVEL_2_SYMPTOM_OVERRIDE_LADDER,
} from './ladder-defs.js'

describe('Escalation ladder drift guard (B.3)', () => {
  const cases: Array<[string, { step: string }[]]> = [
    ['TIER_1_CONTRAINDICATION', TIER_1_LADDER],
    ['TIER_1_ANGIOEDEMA', TIER_1_ANGIOEDEMA_LADDER],
    ['TIER_2_DISCREPANCY', TIER_2_LADDER],
    ['BP_LEVEL_1_HIGH', BP_LEVEL_1_LADDER],
    ['BP_LEVEL_1_LOW', BP_LEVEL_1_LADDER],
    ['BP_LEVEL_2', BP_LEVEL_2_LADDER],
    ['BP_LEVEL_2_SYMPTOM_OVERRIDE', BP_LEVEL_2_SYMPTOM_OVERRIDE_LADDER],
  ]

  it.each(cases)(
    '%s — backend ladder step codes match the shared display contract',
    (tier, backendLadder) => {
      const backendCodes = backendLadder.map((s) => s.step)
      expect(LADDER_STEP_CODES[tier]).toEqual(backendCodes)
    },
  )

  it('shared contract covers every tier the backend defines a ladder for', () => {
    for (const [tier] of cases) {
      expect(LADDER_STEP_CODES[tier]).toBeDefined()
    }
  })
})
