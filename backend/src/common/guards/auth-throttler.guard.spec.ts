import { AuthThrottlerGuard } from './auth-throttler.guard.js'

/**
 * V-03 — the two security-critical behaviours of the guard: how buckets are
 * keyed, and that the test escape hatch cannot be used in production.
 *
 * `getTracker` and `shouldSkip` are `protected`, so reach them through a
 * narrow cast rather than widening the class's real surface.
 */
type GuardInternals = {
  getTracker(req: Record<string, unknown>): Promise<string>
  shouldSkip(context: unknown): Promise<boolean>
}

function makeGuard(): GuardInternals {
  // The base constructor's deps are unused by getTracker/shouldSkip.
  return new AuthThrottlerGuard(
    [] as never,
    {} as never,
    {} as never,
  ) as unknown as GuardInternals
}

describe('AuthThrottlerGuard.getTracker', () => {
  it('keys on ip:email — the unit of abuse is "this client vs this account"', async () => {
    const t = await makeGuard().getTracker({
      ip: '203.0.113.7',
      body: { email: 'patient@example.com' },
    })
    expect(t).toBe('203.0.113.7:patient@example.com')
  })

  it('normalizes the email so case/whitespace cannot mint a fresh bucket', async () => {
    // auth.service.ts does email.trim().toLowerCase() (:2867/:2991/:3412), so
    // 'A@X.com ' and 'a@x.com' are ONE account. If the tracker disagreed, an
    // attacker would get a new 5-attempt budget per capitalisation.
    const g = makeGuard()
    const a = await g.getTracker({ ip: '1.1.1.1', body: { email: '  A@X.com ' } })
    const b = await g.getTracker({ ip: '1.1.1.1', body: { email: 'a@x.com' } })
    expect(a).toBe(b)
    expect(a).toBe('1.1.1.1:a@x.com')
  })

  it('falls back to IP-only where the route carries no email', async () => {
    // mfa/challenge sends a challenge token; refresh sends a cookie.
    const g = makeGuard()
    expect(await g.getTracker({ ip: '1.1.1.1', body: {} })).toBe('1.1.1.1')
    expect(await g.getTracker({ ip: '1.1.1.1' })).toBe('1.1.1.1')
    expect(await g.getTracker({ ip: '1.1.1.1', body: { email: '   ' } })).toBe('1.1.1.1')
  })

  it('does not key on a non-string email (a JSON body is attacker-shaped)', async () => {
    const g = makeGuard()
    expect(await g.getTracker({ ip: '1.1.1.1', body: { email: { $ne: null } } })).toBe(
      '1.1.1.1',
    )
    expect(await g.getTracker({ ip: '1.1.1.1', body: { email: 42 } })).toBe('1.1.1.1')
  })

  it('still yields a key when ip is missing (never returns undefined)', async () => {
    // A tracker of `undefined` would collapse every caller into one bucket.
    const t = await makeGuard().getTracker({ body: { email: 'a@x.com' } })
    expect(t).toBe('unknown-ip:a@x.com')
  })
})

describe('AuthThrottlerGuard.shouldSkip — the test escape hatch', () => {
  const env = process.env
  beforeEach(() => {
    process.env = { ...env }
  })
  afterEach(() => {
    process.env = env
  })

  it('skips when the flag is set outside production', async () => {
    process.env.NODE_ENV = 'test'
    process.env.AUTH_THROTTLE_DISABLED = '1'
    expect(await makeGuard().shouldSkip({} as never)).toBe(true)
  })

  it('IGNORES the flag in production — a flag settable in prod is not a control', async () => {
    process.env.NODE_ENV = 'production'
    process.env.AUTH_THROTTLE_DISABLED = '1'
    // Falls through to the base implementation, which does not skip.
    expect(await makeGuard().shouldSkip({} as never)).toBe(false)
  })

  it('does not skip when the flag is unset', async () => {
    process.env.NODE_ENV = 'test'
    delete process.env.AUTH_THROTTLE_DISABLED
    expect(await makeGuard().shouldSkip({} as never)).toBe(false)
  })

  it('only the exact value "1" skips (not "true"/"0")', async () => {
    process.env.NODE_ENV = 'test'
    const g = makeGuard()
    process.env.AUTH_THROTTLE_DISABLED = 'true'
    expect(await g.shouldSkip({} as never)).toBe(false)
    process.env.AUTH_THROTTLE_DISABLED = '0'
    expect(await g.shouldSkip({} as never)).toBe(false)
  })
})
