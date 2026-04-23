// Phase/7 — ladder-defs pure-data tests.

import {
  ladderForTier,
  nextStep,
  findStep,
  TIER_1_LADDER,
  TIER_2_LADDER,
  BP_LEVEL_2_LADDER,
  BP_LEVEL_2_SYMPTOM_OVERRIDE_LADDER,
  TIER_1_BACKUP_ON_T0,
} from './ladder-defs.js'

describe('ladderForTier', () => {
  it('TIER_1_CONTRAINDICATION → Tier 1 ladder', () => {
    const l = ladderForTier('TIER_1_CONTRAINDICATION')
    expect(l?.kind).toBe('TIER_1')
    expect(l?.steps).toBe(TIER_1_LADDER)
  })

  it('TIER_2_DISCREPANCY → Tier 2 ladder', () => {
    const l = ladderForTier('TIER_2_DISCREPANCY')
    expect(l?.kind).toBe('TIER_2')
    expect(l?.steps).toBe(TIER_2_LADDER)
  })

  it('BP_LEVEL_2 → BP Level 2 ladder', () => {
    const l = ladderForTier('BP_LEVEL_2')
    expect(l?.kind).toBe('BP_LEVEL_2')
    expect(l?.steps).toBe(BP_LEVEL_2_LADDER)
  })

  it('BP_LEVEL_2 → no-symptom ladder (no patient at T+2h)', () => {
    const l = ladderForTier('BP_LEVEL_2')
    expect(l?.steps).toBe(BP_LEVEL_2_LADDER)
    expect(l?.steps[1].step).toBe('T2H')
    expect(l?.steps[1].recipientRoles).toEqual(['MEDICAL_DIRECTOR'])
  })

  it('BP_LEVEL_2_SYMPTOM_OVERRIDE → symptom-override ladder (patient follow-up at T+2h)', () => {
    const l = ladderForTier('BP_LEVEL_2_SYMPTOM_OVERRIDE')
    expect(l?.kind).toBe('BP_LEVEL_2')
    expect(l?.steps).toBe(BP_LEVEL_2_SYMPTOM_OVERRIDE_LADDER)
    expect(l?.steps[1].step).toBe('T2H')
    expect(new Set(l?.steps[1].recipientRoles)).toEqual(
      new Set(['MEDICAL_DIRECTOR', 'PATIENT']),
    )
  })

  it('BP_LEVEL_1_HIGH → null (not escalated)', () => {
    expect(ladderForTier('BP_LEVEL_1_HIGH')).toBeNull()
  })

  it('BP_LEVEL_1_LOW → null', () => {
    expect(ladderForTier('BP_LEVEL_1_LOW')).toBeNull()
  })

  it('TIER_3_INFO → null', () => {
    expect(ladderForTier('TIER_3_INFO')).toBeNull()
  })

  it('null / unknown → null', () => {
    expect(ladderForTier(null)).toBeNull()
    expect(ladderForTier('SOMETHING_ELSE')).toBeNull()
  })
})

describe('ladder shape invariants', () => {
  it('Tier 1 ladder: T0 → T4H → T8H → T24H → T48H', () => {
    expect(TIER_1_LADDER.map((s) => s.step)).toEqual([
      'T0',
      'T4H',
      'T8H',
      'T24H',
      'T48H',
    ])
  })

  it('Tier 1 T+0 recipientRoles = [PRIMARY_PROVIDER] (backup is a separate after-hours rule)', () => {
    expect(TIER_1_LADDER[0].recipientRoles).toEqual(['PRIMARY_PROVIDER'])
  })

  it('Tier 1 T+4H re-sends to primary AND notifies backup (spec V2-D T+4h)', () => {
    const t4 = TIER_1_LADDER[1]
    expect(t4.step).toBe('T4H')
    expect(new Set(t4.recipientRoles)).toEqual(
      new Set(['PRIMARY_PROVIDER', 'BACKUP_PROVIDER']),
    )
  })

  it('Tier 1 backup-on-T0 is a distinct export (after-hours safety net)', () => {
    expect(TIER_1_BACKUP_ON_T0).toEqual(['BACKUP_PROVIDER'])
  })

  it('Tier 2 ladder: T0 → TIER2_48H → TIER2_7D → TIER2_14D', () => {
    expect(TIER_2_LADDER.map((s) => s.step)).toEqual([
      'T0',
      'TIER2_48H',
      'TIER2_7D',
      'TIER2_14D',
    ])
  })

  it('BP Level 2 ladder: T0 → T2H → T4H', () => {
    expect(BP_LEVEL_2_LADDER.map((s) => s.step)).toEqual(['T0', 'T2H', 'T4H'])
  })

  it('BP Level 2 T+0 dual-notifies primary + backup + patient', () => {
    expect(new Set(BP_LEVEL_2_LADDER[0].recipientRoles)).toEqual(
      new Set(['PRIMARY_PROVIDER', 'BACKUP_PROVIDER', 'PATIENT']),
    )
  })

  it('BP Level 2 T+2H does NOT include PATIENT (no symptoms reported variant)', () => {
    const t2 = BP_LEVEL_2_LADDER.find((s) => s.step === 'T2H')
    expect(t2?.recipientRoles).toEqual(['MEDICAL_DIRECTOR'])
    expect(t2?.recipientRoles).not.toContain('PATIENT')
  })

  it('BP Level 2 Symptom Override T+2H includes PATIENT ("Have you called 911?")', () => {
    const t2 = BP_LEVEL_2_SYMPTOM_OVERRIDE_LADDER.find((s) => s.step === 'T2H')
    expect(t2?.recipientRoles && new Set(t2.recipientRoles)).toEqual(
      new Set(['MEDICAL_DIRECTOR', 'PATIENT']),
    )
  })

  it('BP Level 2 Symptom Override ladder same steps as no-symptom ladder', () => {
    expect(BP_LEVEL_2_SYMPTOM_OVERRIDE_LADDER.map((s) => s.step)).toEqual([
      'T0',
      'T2H',
      'T4H',
    ])
  })

  it('BP Level 2 fires immediately at every step (no queueing) — both variants', () => {
    for (const step of BP_LEVEL_2_LADDER) {
      expect(step.afterHoursBehavior).toBe('FIRE_IMMEDIATELY')
    }
    for (const step of BP_LEVEL_2_SYMPTOM_OVERRIDE_LADDER) {
      expect(step.afterHoursBehavior).toBe('FIRE_IMMEDIATELY')
    }
  })

  it('Tier 1 + Tier 2 all queue except documented exceptions', () => {
    for (const step of TIER_1_LADDER) {
      expect(step.afterHoursBehavior).toBe('QUEUE_UNTIL_BUSINESS_HOURS')
    }
    for (const step of TIER_2_LADDER) {
      expect(step.afterHoursBehavior).toBe('QUEUE_UNTIL_BUSINESS_HOURS')
    }
  })

  it('offsets are monotonically non-decreasing within each ladder', () => {
    const check = (steps: typeof TIER_1_LADDER) => {
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i].offsetMs).toBeGreaterThanOrEqual(steps[i - 1].offsetMs)
      }
    }
    check(TIER_1_LADDER)
    check(TIER_2_LADDER)
    check(BP_LEVEL_2_LADDER)
  })
})

describe('nextStep', () => {
  it('null → first step', () => {
    expect(nextStep(TIER_1_LADDER, null)?.step).toBe('T0')
  })

  it('T0 → T4H', () => {
    expect(nextStep(TIER_1_LADDER, 'T0')?.step).toBe('T4H')
  })

  it('T48H → null (ladder finished)', () => {
    expect(nextStep(TIER_1_LADDER, 'T48H')).toBeNull()
  })

  it('BP_LEVEL_2: T2H → T4H', () => {
    expect(nextStep(BP_LEVEL_2_LADDER, 'T2H')?.step).toBe('T4H')
  })

  it('BP_LEVEL_2: T4H → null', () => {
    expect(nextStep(BP_LEVEL_2_LADDER, 'T4H')).toBeNull()
  })

  it('step not in ladder → null', () => {
    expect(nextStep(TIER_1_LADDER, 'TIER2_48H')).toBeNull()
  })
})

describe('findStep', () => {
  it('found → returns the step', () => {
    const s = findStep(TIER_1_LADDER, 'T8H')
    expect(s?.offsetMs).toBe(8 * 60 * 60 * 1000)
  })

  it('not found → null', () => {
    expect(findStep(TIER_1_LADDER, 'T2H')).toBeNull()
  })
})
