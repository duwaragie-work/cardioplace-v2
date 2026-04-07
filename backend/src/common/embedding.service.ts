/**
 * Local embedding service using HuggingFace all-MiniLM-L6-v2 via @xenova/transformers.
 * Runs entirely in-process — no API calls, no rate limits, no cost.
 * Output: 384-dimensional vectors.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name)
  private pipeline: any = null
  private ready = false

  async onModuleInit() {
    try {
      // Dynamic import — @xenova/transformers is ESM
      const { pipeline } = await import('@xenova/transformers')
      this.logger.log('Loading embedding model: all-MiniLM-L6-v2 ...')
      this.pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
      this.ready = true
      this.logger.log('Embedding model loaded (384 dims)')
    } catch (err) {
      this.logger.error('Failed to load embedding model', err)
    }
  }

  /**
   * Generate embeddings for one or more texts.
   * Returns the same shape as GeminiService.getEmbeddings() for drop-in replacement.
   */
  async getEmbeddings(input: string | string[]): Promise<{
    data: Array<{ embedding: number[] }>
  }> {
    const inputs = Array.isArray(input) ? input : [input]

    if (!this.ready || !this.pipeline) {
      this.logger.warn('Embedding model not ready, returning empty embeddings')
      return { data: inputs.map(() => ({ embedding: [] })) }
    }

    const results: Array<{ embedding: number[] }> = []

    for (const text of inputs) {
      const output = await this.pipeline(text, { pooling: 'mean', normalize: true })
      // output.data is a Float32Array — convert to number[]
      const embedding = Array.from(output.data as Float32Array)
      results.push({ embedding })
    }

    return { data: results }
  }
}
