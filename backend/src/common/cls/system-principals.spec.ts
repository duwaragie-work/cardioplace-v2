import {
  SYSTEM_PRINCIPAL_LABELS,
  CRON_LABEL_TO_PRINCIPAL,
  principalLabelFromEmail,
  setSystemPrincipalRegistry,
  getSystemPrincipalId,
  resolveCronActorId,
} from './system-principals.js'

/**
 * System-principal registry resolver (audit, 2026-07-03). Pure-function
 * coverage: the cron-label→principal map, email→label derivation, and the
 * warmed/cold cache behaviour. No DB — the id map is injected via
 * setSystemPrincipalRegistry.
 */
describe('system-principals registry', () => {
  afterEach(() => setSystemPrincipalRegistry(null))

  it('every cron label maps to a known principal label', () => {
    const labels = new Set<string>(SYSTEM_PRINCIPAL_LABELS)
    for (const principal of Object.values(CRON_LABEL_TO_PRINCIPAL)) {
      expect(labels.has(principal)).toBe(true)
    }
  })

  it('every principal has at least one cron/engine label pointing at it', () => {
    const mapped = new Set(Object.values(CRON_LABEL_TO_PRINCIPAL))
    for (const label of SYSTEM_PRINCIPAL_LABELS) {
      expect(mapped.has(label)).toBe(true)
    }
  })

  it('derives the principal label from a seed email', () => {
    expect(principalLabelFromEmail('system-gap-alert@internal.cardioplace.test')).toBe(
      'gap-alert',
    )
    expect(
      principalLabelFromEmail('system-engine-alert-generator@internal.cardioplace.test'),
    ).toBe('engine-alert-generator')
  })

  it('cold registry → null for both resolvers (safe fallback)', () => {
    setSystemPrincipalRegistry(null)
    expect(getSystemPrincipalId('gap-alert')).toBeNull()
    expect(resolveCronActorId('cron-gap-alert')).toBeNull()
  })

  it('warmed registry → resolveCronActorId maps cron label to the principal id', () => {
    setSystemPrincipalRegistry(
      new Map([
        ['gap-alert', 'sys-gap'],
        ['content-scheduler', 'sys-content'],
        ['engine-alert-generator', 'sys-engine'],
      ]),
    )
    expect(resolveCronActorId('cron-gap-alert')).toBe('sys-gap')
    // Label that does not strip cleanly — explicit map is load-bearing.
    expect(resolveCronActorId('cron-content-stale-flag')).toBe('sys-content')
    // Engine handler carries no 'cron-' prefix.
    expect(resolveCronActorId('engine-alert-generator')).toBe('sys-engine')
  })

  it('unknown cron label → null', () => {
    setSystemPrincipalRegistry(new Map([['gap-alert', 'sys-gap']]))
    expect(resolveCronActorId('cron-does-not-exist')).toBeNull()
  })
})
