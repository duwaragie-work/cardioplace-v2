/**
 * Local embedding service using HuggingFace all-MiniLM-L6-v2.
 * Runs entirely in-process — no API calls, no rate limits, no cost.
 * Output: 384-dimensional vectors.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name)
  private extractor: any = null
  private ready = false

  async onModuleInit() {
    try {
      const { pipeline, env } = await import('@huggingface/transformers')
      // Disable local model check warnings
      env.allowLocalModels = false
      this.logger.log('Loading embedding model: all-MiniLM-L6-v2 ...')
      this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
      this.ready = true
      this.logger.log('Embedding model loaded (384 dims)')
    } catch (err) {
      this.logger.error('Failed to load embedding model', err)
    }
  }

  async getEmbeddings(input: string | string[]): Promise<{
    data: Array<{ embedding: number[] }>
  }> {
    const inputs = Array.isArray(input) ? input : [input]

    if (!this.ready || !this.extractor) {
      this.logger.warn('Embedding model not ready, returning empty embeddings')
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
