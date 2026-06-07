// Manual-test round 2 Group A1 — rule-aware alert presentation.
// `RULE_HF_DECOMPENSATION` emits engine tier BP_LEVEL_1_LOW (it claims the
// sbp-low axis), but the alert is about fluid/HF decompensation at potentially
// normal-or-elevated BP. Without a rule-id override the patient would see
// blue "Your blood pressure is low." chrome + hypotension footer at 151/86 —
// clinically wrong on every axis. These tests pin the override + verify it
// doesn't leak into literal low-BP readings.

import { getAlertPresentation } from './alert-presentation'

describe('getAlertPresentation', () => {
  it('returns blue / ArrowDown / "blood pressure is low" for a literal BP_LEVEL_1_LOW with no ruleId override', () => {
    const v = getAlertPresentation({ tier: 'BP_LEVEL_1_LOW', ruleId: 'RULE_HFREF_LOW' })
    expect(v.key).toBe('low')
    expect(v.accent).toBe('#3B82F6')
    expect(v.title).toMatch(/blood pressure is low/i)
    expect(v.footer).toMatch(/stand up slowly/i)
    // Sanity: the Icon is a function/forwardRef (lucide component).
    expect(v.Icon).toBeDefined()
  })

  it('overrides BP_LEVEL_1_LOW for RULE_HF_DECOMPENSATION → amber / Heart / care-team title (Round 2 A1)', () => {
    const v = getAlertPresentation({
      tier: 'BP_LEVEL_1_LOW',
      ruleId: 'RULE_HF_DECOMPENSATION',
    })
    expect(v.key).toBe('attention')
    expect(v.accent).toBe('var(--brand-warning-amber)')
    expect(v.title).toMatch(/care team needs to know/i)
    // Must NOT inherit hypotension footer/followUp.
    expect(v.footer).not.toMatch(/stand up slowly/i)
    expect(v.followUp).not.toMatch(/salty snack/i)
    expect(v.defaultBody).toMatch(/swelling|weight/i)
  })

  it('high BP still renders amber/up-arrow regardless of ruleId', () => {
    const v = getAlertPresentation({ tier: 'BP_LEVEL_1_HIGH', ruleId: 'RULE_STANDARD_L1_HIGH' })
    expect(v.key).toBe('high')
    expect(v.title).toMatch(/elevated/i)
  })

  it('TIER_1_ANGIOEDEMA renders the urgent red treatment', () => {
    const v = getAlertPresentation({ tier: 'TIER_1_ANGIOEDEMA', ruleId: 'RULE_ACE_ANGIOEDEMA' })
    expect(v.key).toBe('emergency')
    expect(v.accent).toBe('var(--brand-alert-red)')
    expect(v.title).toMatch(/urgent/i)
  })

  it('falls back to a safe info variant when tier is null and no ruleId override', () => {
    const v = getAlertPresentation({ tier: null, ruleId: null })
    expect(v.key).toBe('info')
    expect(v.title).toBeTruthy()
    expect(v.Icon).toBeDefined()
  })
})
