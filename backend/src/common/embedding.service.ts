/**
 * Local embedding service using HuggingFace all-MiniLM-L6-v2.
 * Runs entirely in-process — no API calls, no rate limits, no cost.
 * Output: 384-dimensional vectors.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

/**
 * Retry `op` with exponential backoff. Returns true on the first success,
 * false once all attempts are exhausted. Pure + exported so the retry control
 * flow is unit-testable without loading ONNX (inject `sleep` to skip real
 * delays). #3-svc (2026-07-18).
 */
export async function retryWithBackoff(
  op: () => Promise<void>,
  opts: {
    attempts: number
    baseMs: number
    maxMs: number
    sleep?: (ms: number) => Promise<void>
    onRetry?: (attempt: number, err: unknown) => void
  },
): Promise<boolean> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      await op()
      return true
    } catch (err) {
      opts.onRetry?.(attempt, err)
      if (attempt < opts.attempts) {
        await sleep(Math.min(opts.maxMs, opts.baseMs * 2 ** (attempt - 1)))
      }
    }
  }
  return false
}

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name)
  private extractor: any = null
  private ready = false
  // Dedup handle: concurrent callers (boot warm + inbound chat) share ONE
  // in-flight load instead of stampeding the HF Hub. #3-svc.
  private loadingPromise: Promise<void> | null = null

  private static readonly MAX_LOAD_ATTEMPTS = 5

  async onModuleInit() {
    // Kick off model load asynchronously — don't block Nest boot on the
    // first-time HuggingFace download (~50MB). Callers using getEmbeddings()
    // before the model is ready hit the graceful fallback below (empty vectors
    // + warn), so the chat surface degrades gracefully rather than refusing to
    // start. #3-svc: this is now retrying + lazily recoverable.
    void this.ensureLoaded()
  }

  /**
   * Idempotent, deduped loader. Returns immediately if ready; otherwise shares
   * the single in-flight load. Safe to call on every getEmbeddings() miss — a
   * container that failed its boot load recovers without a restart. #3-svc.
   */
  private ensureLoaded(): Promise<void> {
    if (this.ready) return Promise.resolve()
    if (this.loadingPromise) return this.loadingPromise
    this.loadingPromise = this.loadModelWithRetry().finally(() => {
      this.loadingPromise = null
    })
    return this.loadingPromise
  }

  private async loadModelWithRetry(): Promise<void> {
    // Skip the embedding model in test mode. Jest's `--experimental-vm-modules`
    // runs ONNX in a separate JS realm — the WASM binding's Float32Array
    // doesn't match the test runner's, so the Tensor constructor's
    // `instanceof Float32Array` check throws. Production (vanilla node, single
    // realm) is unaffected. Leaving ready=false here means getEmbeddings()
    // returns empty vectors and RagService skips.
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
      this.logger.log(
        'Embedding model load skipped in test mode (Jest VM-modules realm boundary)',
      )
      return
    }

    const ok = await retryWithBackoff(() => this.attemptLoad(), {
      attempts: EmbeddingService.MAX_LOAD_ATTEMPTS,
      baseMs: 1000,
      maxMs: 30_000,
      onRetry: (attempt, err) =>
        this.logger.error(
          `Embedding model load attempt ${attempt}/${EmbeddingService.MAX_LOAD_ATTEMPTS} failed; will retry with backoff`,
          err instanceof Error ? err.stack : String(err),
        ),
    })

    if (!ok) {
      // Stable, monitorable key — a CloudWatch/Loki metric filter can alert on
      // it. Previously the only signal was a per-request warn, invisible to
      // monitoring; RAG ran silently degraded. #3-svc.
      this.logger.error(
        'EMBEDDING_MODEL_UNAVAILABLE — all load attempts failed; RAG + KB ' +
          'retrieval degraded to empty until recovery. Check huggingface.co ' +
          'reachability / model cache. Next getEmbeddings() will re-attempt.',
      )
    }
  }

  /** One load attempt — the un-testable ONNX bit, isolated so the retry loop
   *  around it stays pure. */
  private async attemptLoad(): Promise<void> {
    const { pipeline, env } = await import('@huggingface/transformers')
    // Disable local model check warnings.
    env.allowLocalModels = false
    // #3-img — when the Docker image bakes the model into a cache dir (set via
    // EMBEDDING_MODEL_CACHE_DIR), point transformers.js at it. It loads
    // cache-first, so a populated cache means a deterministic, offline-safe
    // cold boot with zero huggingface.co dependency; if the cache is absent
    // (local dev), it falls back to the default cache + network, guarded by the
    // retry above. No hard-coded infra path in the code — the Dockerfile owns it.
    if (process.env.EMBEDDING_MODEL_CACHE_DIR) {
      env.cacheDir = process.env.EMBEDDING_MODEL_CACHE_DIR
    }
    this.logger.log('Loading embedding model: all-MiniLM-L6-v2 ...')
    this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
    this.ready = true
    this.logger.log('Embedding model loaded (384 dims)')
  }

  async getEmbeddings(input: string | string[]): Promise<{
    data: Array<{ embedding: number[] }>
  }> {
    const inputs = Array.isArray(input) ? input : [input]

    if (!this.ready || !this.extractor) {
      // #3-svc — kick off a background (deduped) recovery load so a container
      // that missed or failed its boot load heals without a restart. Non-
      // blocking: this request still degrades gracefully (empty vectors), the
      // next one benefits once the load completes.
      void this.ensureLoaded()
      this.logger.warn(
        'Embedding model not ready, returning empty embeddings (recovery load in progress)',
      )
      return { data: inputs.map(() => ({ embedding: [] })) }
    }

    const results: Array<{ embedding: number[] }> = []

    for (const text of inputs) {
      const output = await this.extractor(text, { pooling: 'mean', normalize: true })
      // output is a Tensor — convert to plain number array
      const embedding = Array.from(output.tolist()[0] as number[])
      results.push({ embedding })
    }

    return { data: results }
  }
}
