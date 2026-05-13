// Cluster 6 bug #11 — withDeadlockRetry helper tests.
//
// Verifies the retry semantics shared by AlertEngineService.persistAlert and
// EscalationService.dispatchStep. The actual write call is the responsibility
// of the caller; this spec exercises only the retry loop.

import { jest } from '@jest/globals'
import { withDeadlockRetry } from './deadlock-retry.js'

const silentLogger = { warn: () => {} }

describe('withDeadlockRetry', () => {
  it('returns the value on first success without retrying', async () => {
    const fn = jest.fn<() => Promise<string>>().mockResolvedValue('ok')
    const result = await withDeadlockRetry('test', fn, silentLogger)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on Prisma P2034 then succeeds', async () => {
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockResolvedValueOnce('ok')
    const result = await withDeadlockRetry('test', fn, silentLogger, 3)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on Postgres 40P01 (meta.code) then succeeds', async () => {
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ meta: { code: '40P01' } })
      .mockResolvedValueOnce('ok')
    const result = await withDeadlockRetry('test', fn, silentLogger, 3)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on Postgres 40P01 (cause.code) then succeeds', async () => {
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ cause: { code: '40P01' } })
      .mockResolvedValueOnce('ok')
    const result = await withDeadlockRetry('test', fn, silentLogger, 3)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('surfaces non-deadlock errors immediately without retry', async () => {
    const err = new Error('not-a-deadlock')
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(err)
    await expect(withDeadlockRetry('test', fn, silentLogger, 3)).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('exhausts attempts and rethrows on persistent deadlock', async () => {
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue({ code: 'P2034' })
    await expect(withDeadlockRetry('test', fn, silentLogger, 3)).rejects.toMatchObject({
      code: 'P2034',
    })
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('warns on each retry with the supplied label', async () => {
    const warn = jest.fn()
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockResolvedValueOnce('ok')
    await withDeadlockRetry('persistAlert:r1:e1', fn, { warn }, 3)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0][0]).toContain('persistAlert:r1:e1')
    expect(warn.mock.calls[0][0]).toContain('attempt 1/3')
  })
})
