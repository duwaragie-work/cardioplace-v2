/**
 * Embedding service — delegates to GeminiService (text-embedding-004).
 * Replaces the old local @xenova/transformers approach that crashed in
 * slim containers due to missing onnxruntime native libs.
 */
import { Injectable, Logger } from '@nestjs/common'
import { GeminiService } from '../gemini/gemini.service.js'

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name)

  constructor(private readonly geminiService: GeminiService) {}

  async getEmbeddings(input: string | string[]): Promise<{
    data: Array<{ embedding: number[] }>
  }> {
    try {
      return await this.geminiService.getEmbeddings(input)
    } catch (err) {
      this.logger.error('Gemini embedding failed, returning empty vectors', err)
      const inputs = Array.isArray(input) ? input : [input]
      return { data: inputs.map(() => ({ embedding: [] })) }
    }
  }
}
