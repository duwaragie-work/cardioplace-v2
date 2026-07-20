import { jest } from '@jest/globals'
import { EmbeddingService, retryWithBackoff } from './embedding.service.js'

/**
 * #3-svc (2026-07-18) — embedding-model resilience. Prod fetches the model from
 * huggingface.co on every boot, fire-and-forget, and (pre-fix) never retried:
 * one HF blip left `ready=false` for the container's life, silently degrading
 * RAG. These prove the retry control flow and the graceful/deduped recovery
 * path. The real ONNX load is skipped in Jest (VM-modules realm), so we test
 * the pure `retryWithBackoff` and the not-ready behavior of getEmbeddings.
 */

const noSleep = () => Promise.resolve()

describe('retryWithBackoff', () => {
  it('returns true on first success — op called once', async () => {
    const op = jest.fn(async () => {})
    const ok = await retryWithBackoff(op, { attempts: 5, baseMs: 1, maxMs: 1, sleep: noSleep })
    expect(ok).toBe(true)
    expect(op).toHaveBeenCalledTimes(1)
  })

  it('retries a transient failure then succeeds', async () => {
    let n = 0
    const op = jest.fn(async () => {
      if (++n < 3) throw new Error('HF blip')
    })
    const onRetry = jest.fn()
    const ok = await retryWithBackoff(op, {
      attempts: 5,
      baseMs: 1,
      maxMs: 1,
      sleep: noSleep,
      onRetry,
    })
    expect(ok).toBe(true)
    expect(op).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2) // two failures before success
  })

  it('exhausts all attempts and returns false (→ the stable UNAVAILABLE signal)', async () => {
    const op = jest.fn(async () => {
      throw new Error('HF down')
    })
    const ok = await retryWithBackoff(op, { attempts: 4, baseMs: 1, maxMs: 1, sleep: noSleep })
    expect(ok).toBe(false)
    expect(op).toHaveBeenCalledTimes(4)
  })

  it('caps backoff at maxMs', async () => {
    const delays: number[] = []
    const op = jest.fn(async () => {
      throw new Error('x')
    })
    await retryWithBackoff(op, {
      attempts: 5,
      baseMs: 1000,
      maxMs: 3000,
      sleep: (ms) => {
        delays.push(ms)
        return Promise.resolve()
      },
    })
    // 1000, 2000, 3000(capped from 4000), 3000(capped from 8000)
    expect(delays).toEqual([1000, 2000, 3000, 3000])
  })
})

describe('EmbeddingService.getEmbeddings — not-ready graceful path', () => {
  const orig = process.env.NODE_ENV
  beforeAll(() => {
    // Force the test-skip so the real ONNX load never runs; the service stays
    // not-ready, which is exactly the degraded state we want to exercise.
    process.env.NODE_ENV = 'test'
  })
  afterAll(() => {
    process.env.NODE_ENV = orig
  })

  it('returns one empty vector per input instead of throwing', async () => {
    const svc = new EmbeddingService()
    const out = await svc.getEmbeddings(['a', 'b', 'c'])
    expect(out.data).toHaveLength(3)
    expect(out.data.every((d) => Array.isArray(d.embedding) && d.embedding.length === 0)).toBe(true)
  })

  it('normalizes a single string to a one-element result', async () => {
    const svc = new EmbeddingService()
    const out = await svc.getEmbeddings('hello')
    expect(out.data).toHaveLength(1)
    expect(out.data[0].embedding).toEqual([])
  })
})
