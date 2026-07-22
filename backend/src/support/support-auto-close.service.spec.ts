import { jest } from '@jest/globals'
import { SupportAutoCloseService } from './support-auto-close.service.js'

// The cron wrapper is thin: it must run the sweep inside a CLS actor scope
// (so the SupportTicket writes attribute to the seeded system principal) and
// surface the closed count. The lifecycle logic itself is covered in
// support.service.spec.

function make(count: number) {
  const support = {
    autoCloseResolvedTickets: jest.fn(async () => count) as any,
  }
  // Minimal CLS fake — runAsCronActor calls cls.run(fn) then cls.set(...).
  let ranInScope = false
  const cls = {
    run: async (fn: () => Promise<unknown>) => {
      ranInScope = true
      return fn()
    },
    set: jest.fn(),
    get: jest.fn(),
  } as any
  const svc = new SupportAutoCloseService(support as any, cls)
  return { svc, support, cls, scoped: () => ranInScope }
}

describe('SupportAutoCloseService', () => {
  it('runs the sweep inside the cron-actor scope', async () => {
    const { svc, support, scoped } = make(3)
    await svc.scheduledRun()
    expect(support.autoCloseResolvedTickets).toHaveBeenCalledTimes(1)
    expect(scoped()).toBe(true)
  })

  it('sets the support-auto-close CLS actor label', async () => {
    const { svc, cls } = make(0)
    await svc.scheduledRun()
    // runAsCronActor stamps systemActorLabel with the cron label.
    expect(cls.set).toHaveBeenCalledWith('systemActorLabel', 'cron-support-auto-close')
    expect(cls.set).toHaveBeenCalledWith('actorType', 'SYSTEM_ACTOR')
  })

  it('does not throw when nothing is eligible', async () => {
    const { svc, support } = make(0)
    await expect(svc.scheduledRun()).resolves.toBeUndefined()
    expect(support.autoCloseResolvedTickets).toHaveBeenCalled()
  })
})
