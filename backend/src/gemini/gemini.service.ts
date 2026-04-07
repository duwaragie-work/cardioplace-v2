import { GoogleGenAI } from '@google/genai'
import type { Content, FunctionDeclaration, GenerateContentResponse } from '@google/genai'
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { LangSmithService } from '../common/langsmith.service.js'

const MAX_RETRIES = 5
const BASE_DELAY_MS = 2000

@Injectable()
export class GeminiService implements OnModuleInit {
  private readonly logger = new Logger(GeminiService.name)
  private client!: GoogleGenAI
  private chatModel!: string

  constructor(
    private configService: ConfigService,
    @Optional() private langsmith?: LangSmithService,
  ) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('GOOGLE_API_KEY')
    this.chatModel = this.configService.get<string>('GEMINI_CHAT_MODEL') || 'gemini-2.5-flash'

    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY is not defined in environment')
    }

    this.client = new GoogleGenAI({ apiKey })
  }

  /**
   * Retry helper for transient 429 / 5xx errors with exponential backoff.
   * Parses the retryDelay from 429 responses when available.
   */
  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn()
      } catch (err: any) {
        const status = err?.statusCode ?? err?.status ?? err?.code ?? 0
        const retryable = status === 429 || (typeof status === 'number' && status >= 500)
        if (!retryable || attempt === MAX_RETRIES) throw err

        // Try to extract retryDelay from the error message (e.g. "Please retry in 14.5s")
        let delay = BASE_DELAY_MS * 2 ** attempt
        const retryMatch = String(err?.message ?? '').match(/retry in (\d+\.?\d*)s/i)
        if (retryMatch) {
          delay = Math.ceil(parseFloat(retryMatch[1]) * 1000) + 500
        }

        this.logger.warn(
          `${label} failed with ${status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
        )
        await new Promise((r) => setTimeout(r, delay))
      }
    }
    throw new Error('unreachable')
  }

  get clientInstance(): GoogleGenAI {
    return this.client
  }

  get chatModelName(): string {
    return this.chatModel
  }

  /**
   * Chat completion — returns a normalised shape:
   * { choices: [{ message: { content: string } }] }
   */
  async getChatCompletion(messages: Array<{ role: string; content: string }>) {
    return this.withRetry('getChatCompletion', async () => {
      const systemParts = messages.filter((m) => m.role === 'system')
      const conversationParts = messages.filter((m) => m.role !== 'system')

      const contents = conversationParts.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

      const response = await this.client.models.generateContent({
        model: this.chatModel,
        contents,
        config: {
          systemInstruction: systemParts.length > 0
            ? systemParts.map((m) => m.content).join('\n')
            : undefined,
        },
      })

      const text = response.text ?? ''

      const usage = response.usageMetadata
      this.langsmith?.traceRun('getChatCompletion', {
        model: this.chatModel,
        inputTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
        totalTokens: usage?.totalTokenCount,
        latencyMs: 0,
        source: 'text',
      })

      return {
        choices: [{ message: { content: text, role: 'assistant' as const } }],
      }
    })
  }

  /**
   * Generate embeddings via Gemini text-embedding-004.
   * Returns 768-dimensional vectors.
   */
  async getEmbeddings(input: string | string[]): Promise<{
    data: Array<{ embedding: number[] }>
  }> {
    const inputs = Array.isArray(input) ? input : [input]
    return this.withRetry('getEmbeddings', async () => {
      const data: Array<{ embedding: number[] }> = []
      for (const text of inputs) {
        const response = await this.client.models.embedContent({
          model: 'text-embedding-004',
          contents: text,
        })
        data.push({ embedding: response.embeddings?.[0]?.values ?? [] })
      }
      return { data }
    })
  }

  /**
   * Generate content with function calling support.
   * Returns the raw Gemini response so the caller can inspect functionCall parts.
   */
  async generateContentWithTools(opts: {
    contents: Content[]
    systemInstruction?: string
    tools?: FunctionDeclaration[]
  }): Promise<GenerateContentResponse> {
    return this.withRetry('generateContentWithTools', async () => {
      const response = await this.client.models.generateContent({
        model: this.chatModel,
        contents: opts.contents,
        config: {
          systemInstruction: opts.systemInstruction || undefined,
          tools: opts.tools?.length
            ? [{ functionDeclarations: opts.tools }]
            : undefined,
        },
      })

      const usage = response.usageMetadata
      this.langsmith?.traceRun('generateContentWithTools', {
        model: this.chatModel,
        inputTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
        totalTokens: usage?.totalTokenCount,
        latencyMs: 0,
        source: 'text',
      })

      return response
    })
  }
}
