import { AsyncLocalStorage } from 'node:async_hooks'
import { ClsService } from 'nestjs-cls'
import { runAsCronActor } from './cron-actor.util.js'
import { setSystemPrincipalRegistry } from './system-principals.js'

/**
 * Cron actor attribution (Humaira N8 / 164.312-T7). runAsCronActor opens a
 * fresh CLS context for a @Cron body and stamps a stable systemActorLabel so
 * the SYSTEM_ACTOR AccessLog rows a cron writes name their process. A real
 * ClsService (backed by a bare AsyncLocalStorage) is used so the context
 * semantics — not a stub — are what's under test.
 */
function realCls(): ClsService {
  return new ClsService(new AsyncLocalStorage())
}

describe('runAsCronActor', () => {
  it('runs the inner function within an active CLS context', async () => {
    const cls = realCls()
    expect(cls.isActive()).toBe(false)

    let wasActive = false
    await runAsCronActor(cls, 'cron-x', async () => {
      wasActive = cls.isActive()
    })

    expect(wasActive).toBe(true)
    // Context does not leak past the run.
    expect(cls.isActive()).toBe(false)
  })

  it('cold registry → actorId null (safe fallback), SYSTEM_ACTOR + label set', async () => {
    setSystemPrincipalRegistry(null)
    const cls = realCls()

    const seen = await runAsCronActor(cls, 'cron-gap-alert', async () => ({
      actorId: cls.get('actorId'),
      actorType: cls.get('actorType'),
      systemActorLabel: cls.get('systemActorLabel'),
      ip: cls.get('ip'),
      userAgent: cls.get('userAgent'),
    }))

    expect(seen).toEqual({
      actorId: null,
      actorType: 'SYSTEM_ACTOR',
      systemActorLabel: 'cron-gap-alert',
      ip: null,
      userAgent: null,
    })
  })

  it('warmed registry → resolves the system principal actorId, keeps SYSTEM_ACTOR + original label', async () => {
    setSystemPrincipalRegistry(new Map([['gap-alert', 'sys-gap-id']]))
    const cls = realCls()

    const seen = await runAsCronActor(cls, 'cron-gap-alert', async () => ({
      actorId: cls.get('actorId'),
      actorType: cls.get('actorType'),
      systemActorLabel: cls.get('systemActorLabel'),
    }))

    expect(seen).toEqual({
      actorId: 'sys-gap-id',
      actorType: 'SYSTEM_ACTOR',
      systemActorLabel: 'cron-gap-alert',
    })
    setSystemPrincipalRegistry(null) // reset for other tests
  })

  it('preserves the inner function return value', async () => {
    const cls = realCls()
    const result = await runAsCronActor(cls, 'cron-x', async () => 42)
    expect(result).toBe(42)
  })

  it('propagates errors thrown by the inner function', async () => {
    const cls = realCls()
    await expect(
      runAsCronActor(cls, 'cron-x', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })

  it('gives each invocation an isolated label (no cross-run bleed)', async () => {
    const cls = realCls()
    const a = await runAsCronActor(cls, 'cron-a', async () =>
      cls.get('systemActorLabel'),
    )
    const b = await runAsCronActor(cls, 'cron-b', async () =>
      cls.get('systemActorLabel'),
    )
    expect(a).toBe('cron-a')
    expect(b).toBe('cron-b')
  })
})
