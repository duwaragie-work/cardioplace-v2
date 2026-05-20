// Phase/7 — ladder-defs pure-data tests.

import {
  ladderForTier,
  nextStep,
  findStep,
  TIER_1_LADDER,
  TIER_1_ANGIOEDEMA_LADDER,
  TIER_2_LADDER,
  BP_LEVEL_1_LADDER,
  BP_LEVEL_2_LADDER,
  BP_LEVEL_2_SYMPTOM_OVERRIDE_LADDER,
  TIER_1_BACKUP_ON_T0,
  ANGIOEDEMA_PATIENT_T0,
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

  it('BP_LEVEL_1_HIGH → BP Level 1 ladder (phase/23 — both HIGH and LOW share the ladder shape)', () => {
    // Pre-phase/23 these returned null. Phase/23 shipped BP_LEVEL_1_LADDER
    // (T0/T24H/T72H/T7D, yellow banner, queues for business hours); the
    // registry-resolved patient/physician messages still disambiguate HIGH
    // vs LOW wording.
    const l = ladderForTier('BP_LEVEL_1_HIGH')
    expect(l?.kind).toBe('BP_LEVEL_1')
    expect(l?.steps).toBe(BP_LEVEL_1_LADDER)
  })

  it('BP_LEVEL_1_LOW → same BP Level 1 ladder as HIGH (phase/23)', () => {
    const l = ladderForTier('BP_LEVEL_1_LOW')
    expect(l?.kind).toBe('BP_LEVEL_1')
    expect(l?.steps).toBe(BP_LEVEL_1_LADDER)
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

// ─── Cluster 8 §C.1 — angioedema compressed-ladder shape ──────────────────
// Source: Manisha 5/18/26 ACE-angioedema sign-off + ladder-defs comment.
// The angioedema ladder must be DISTINCT from the standard Tier 1 ladder:
//   T+0  primary
//   T+15m backup
//   T+1h  medical director + ops
//   T+4h  ops
// Every step fires IMMEDIATELY (no after-hours queue — airway emergency).
// Patient + caregiver dispatch are wired separately via ANGIOEDEMA_PATIENT_T0
// + EscalationService.fireT0; not part of the provider ladder steps.

describe('Cluster 8 — TIER_1_ANGIOEDEMA_LADDER (compressed)', () => {
  it('routes TIER_1_ANGIOEDEMA → angioedema ladder, kind TIER_1', () => {
    const l = ladderForTier('TIER_1_ANGIOEDEMA')
    expect(l).not.toBeNull()
    // Tier-1 KIND (inherits non-dismissable + 15-field audit) but
    // STEPS are the compressed list.
    expect(l?.kind).toBe('TIER_1')
    expect(l?.steps).toBe(TIER_1_ANGIOEDEMA_LADDER)
  })

  it('ladder shape: T0 → T15M → T1H → T4H (compressed vs standard T0/T4H/T8H/T24H/T48H)', () => {
    expect(TIER_1_ANGIOEDEMA_LADDER.map((s) => s.step)).toEqual([
      'T0',
      'T15M',
      'T1H',
      'T4H',
    ])
  })

  it('offsets are exactly 0 / 15m / 1h / 4h (regression guard for the compressed clock)', () => {
    const MIN = 60 * 1000
    const HR = 60 * MIN
    const ms = TIER_1_ANGIOEDEMA_LADDER.map((s) => s.offsetMs)
    expect(ms).toEqual([0, 15 * MIN, HR, 4 * HR])
  })

  it('recipients per rung match the sign-off (primary → backup → director+ops → ops)', () => {
    const byStep = Object.fromEntries(
      TIER_1_ANGIOEDEMA_LADDER.map((s) => [s.step, s.recipientRoles]),
    )
    expect(byStep.T0).toEqual(['PRIMARY_PROVIDER'])
    expect(byStep.T15M).toEqual(['BACKUP_PROVIDER'])
    // T+1h is the medical director + ops co-fire (doc: "1h med director").
    expect(new Set(byStep.T1H)).toEqual(
      new Set(['MEDICAL_DIRECTOR', 'HEALPLACE_OPS']),
    )
    expect(byStep.T4H).toEqual(['HEALPLACE_OPS'])
  })

  it('every step fires IMMEDIATELY (FIRE_IMMEDIATELY) — airway never queues for business hours', () => {
    for (const step of TIER_1_ANGIOEDEMA_LADDER) {
      expect(step.afterHoursBehavior).toBe('FIRE_IMMEDIATELY')
    }
  })

  it('every step shows the animated red banner (top-priority surface on admin dashboard)', () => {
    for (const step of TIER_1_ANGIOEDEMA_LADDER) {
      expect(step.displayHint).toBe('RED_BANNER_ANIMATED')
    }
  })

  it('offsets are monotonically non-decreasing', () => {
    for (let i = 1; i < TIER_1_ANGIOEDEMA_LADDER.length; i++) {
      expect(TIER_1_ANGIOEDEMA_LADDER[i].offsetMs).toBeGreaterThanOrEqual(
        TIER_1_ANGIOEDEMA_LADDER[i - 1].offsetMs,
      )
    }
  })

  it('distinct from the standard Tier 1 ladder — no cross-wiring (regression guard)', () => {
    // Same `kind` ('TIER_1') but the steps array must be a different
    // object — a regression that wired TIER_1_ANGIOEDEMA back to
    // TIER_1_LADDER would silently slow the airway escalation from
    // minutes/hours back to the 4h / 8h / 24h cadence.
    expect(TIER_1_ANGIOEDEMA_LADDER).not.toBe(TIER_1_LADDER)
    // And the rung set differs: standard has T8H/T24H/T48H; compressed
    // has T15M/T1H.
    const stdSteps = new Set(TIER_1_LADDER.map((s) => s.step))
    const aeSteps = new Set(TIER_1_ANGIOEDEMA_LADDER.map((s) => s.step))
    expect(aeSteps.has('T15M')).toBe(true)
    expect(aeSteps.has('T1H')).toBe(true)
    expect(stdSteps.has('T15M')).toBe(false)
    expect(stdSteps.has('T1H')).toBe(false)
  })

  it('TIER_1_CONTRAINDICATION still routes to the STANDARD ladder (no cross-wiring)', () => {
    // Spec 1 contraindications (NDHP_HFREF, PREGNANCY_ACE_ARB, etc) MUST
    // keep their T+0/T+4h/T+8h/T+24h/T+48h cadence. A regression that
    // dropped contraindications onto the compressed ladder would page
    // every responder within an hour for non-airway issues.
    const l = ladderForTier('TIER_1_CONTRAINDICATION')
    expect(l?.steps).toBe(TIER_1_LADDER)
    expect(l?.steps).not.toBe(TIER_1_ANGIOEDEMA_LADDER)
  })

  it('ANGIOEDEMA_PATIENT_T0 row exists and fires immediately to PATIENT at T+0', () => {
    // Separate from the provider ladder so the recipientRoles[0] of the
    // provider rung stays clean (admin display + dispatch routing).
    expect(ANGIOEDEMA_PATIENT_T0.step).toBe('T0')
    expect(ANGIOEDEMA_PATIENT_T0.offsetMs).toBe(0)
    expect(ANGIOEDEMA_PATIENT_T0.recipientRoles).toEqual(['PATIENT'])
    expect(ANGIOEDEMA_PATIENT_T0.afterHoursBehavior).toBe('FIRE_IMMEDIATELY')
  })

  it('nextStep walks the compressed ladder end-to-end', () => {
    expect(nextStep(TIER_1_ANGIOEDEMA_LADDER, null)?.step).toBe('T0')
    expect(nextStep(TIER_1_ANGIOEDEMA_LADDER, 'T0')?.step).toBe('T15M')
    expect(nextStep(TIER_1_ANGIOEDEMA_LADDER, 'T15M')?.step).toBe('T1H')
    expect(nextStep(TIER_1_ANGIOEDEMA_LADDER, 'T1H')?.step).toBe('T4H')
    expect(nextStep(TIER_1_ANGIOEDEMA_LADDER, 'T4H')).toBeNull()
  })
})
