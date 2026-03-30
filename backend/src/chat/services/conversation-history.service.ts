import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service.js'
import { MistralService } from '../../mistral/mistral.service.js'
import { SystemPromptConfig } from '../dto/system-prompt-config.dto.js'

@Injectable()
export class ConversationHistoryService {
  /** In-memory cache: sessionId → { summary, expiresAt (5 min TTL) } */
  private readonly summaryCache = new Map<string, { summary: string; expiresAt: number }>()

  /** Call this whenever new conversation data is written for a session (e.g. voice session end). */
  invalidateSummaryCache(sessionId: string): void {
    this.summaryCache.delete(sessionId)
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly mistralService: MistralService,
  ) {}

  /**
   * Retrieve the most relevant past messages for a session.
   *
   * - Text turns (with embeddings): ranked by vector similarity to the current query.
   * - Voice turns (no embedding): fetched chronologically and merged in.
   *
   * Both sets are merged and returned in chronological order so the LLM sees
   * the full conversation history regardless of whether turns came from text or voice.
   */
  async getConversationHistory(
    sessionId: string,
    query: string,
  ): Promise<[string, string][]> {
    try {
      if (!query?.trim()) return []

      type RawRow = { userMessage: string; aiResponse: string; timestamp: Date }

      // ── 1. Vector-similarity fetch for text turns ────────────────────────
      const embeddingResponse = await this.mistralService.getEmbeddings(query)
      const queryEmbedding = embeddingResponse.data[0]?.embedding

      let textResults: RawRow[] = []
      if (queryEmbedding) {
        const embeddingString = `[${queryEmbedding.join(',')}]`
        textResults = await (this.prisma as any).$queryRawUnsafe(
          `SELECT "userMessage", "aiResponse", timestamp
           FROM "Conversation"
           WHERE "sessionId" = $1 AND embedding IS NOT NULL
           ORDER BY embedding <-> $2::vector
           LIMIT 8`,
          sessionId,
          embeddingString,
        )
      }

      // ── 2. Chronological fetch for voice turns (no embedding) ────────────
      const voiceResults: RawRow[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT "userMessage", "aiResponse", timestamp
         FROM "Conversation"
         WHERE "sessionId" = $1 AND embedding IS NULL
         ORDER BY timestamp DESC
         LIMIT 4`,
        sessionId,
      )

      // ── 3. Merge, deduplicate by timestamp+message, sort chronologically ──
      const seen = new Set<string>()
      const merged: RawRow[] = []
      for (const row of [...textResults, ...voiceResults]) {
        const key = `${new Date(row.timestamp).getTime()}:${row.userMessage.slice(0, 40)}`
        if (!seen.has(key)) {
          seen.add(key)
          merged.push(row)
        }
      }

      const sorted = merged.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      )

      const history: [string, string][] = []
      for (const row of sorted) {
        history.push(['human', row.userMessage])
        history.push(['ai', row.aiResponse])
      }

      console.log(
        `Retrieved ${history.length / 2} conversation turns for session ${sessionId} ` +
        `(${textResults.length} text, ${voiceResults.length} voice)`,
      )
      return history
    } catch (error) {
      console.error('Error retrieving conversation history:', error)
      return []
    }
  }

  /**
   * Embed and persist a user/AI conversation turn.
   */
  async saveConversation(
    sessionId: string,
    userMessage: string,
    aiResponse: string,
    config: SystemPromptConfig,
  ): Promise<void> {
    try {
      const memoryContent = `Human: ${userMessage}\nAI: ${aiResponse}`
      if (!memoryContent.trim()) return

      const embeddingResponse = await this.mistralService.getEmbeddings(memoryContent)
      const embedding = embeddingResponse.data[0]?.embedding

      if (embedding) {
        const embeddingString = `[${embedding.join(',')}]`
        await (this.prisma as any).$executeRawUnsafe(
          `INSERT INTO "Conversation" (
            id, "sessionId", "userMessage", "aiResponse", embedding,
            "medicalLens", tone, "detailLevel", "careApproach", spirituality
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4::vector, $5, $6, $7, $8, $9
          )`,
          sessionId,
          userMessage,
          aiResponse,
          embeddingString,
          config.medicalLens,
          config.tone,
          config.detailLevel,
          config.careApproach,
          config.spirituality,
        )
      } else {
        await (this.prisma as any).$executeRawUnsafe(
          `INSERT INTO "Conversation" (
            id, "sessionId", "userMessage", "aiResponse",
            "medicalLens", tone, "detailLevel", "careApproach", spirituality
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8
          )`,
          sessionId,
          userMessage,
          aiResponse,
          config.medicalLens,
          config.tone,
          config.detailLevel,
          config.careApproach,
          config.spirituality,
        )
      }

      console.log(`Saved conversation for session ${sessionId}`)
    } catch (error) {
      console.error('Error saving conversation:', error)
    }
  }

  /**
   * Generate (and cache for 5 min) a concise summary of all conversations
   * in a session — both text and voice turns — for injection into system prompts.
   * Returns an empty string if there is no history yet.
   */
  async generateContextSummary(sessionId: string): Promise<string> {
    if (!sessionId) return ''

    // Return cached summary if still fresh
    const cached = this.summaryCache.get(sessionId)
    if (cached && Date.now() < cached.expiresAt) return cached.summary

    try {
      type Row = { userMessage: string; aiResponse: string; source: string; timestamp: Date }

      const rows: Row[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT "userMessage", "aiResponse", source, timestamp
         FROM "Conversation"
         WHERE "sessionId" = $1
         ORDER BY timestamp ASC
         LIMIT 20`,
        sessionId,
      )

      if (rows.length === 0) return ''

      // Build readable history text
      const historyText = rows
        .map((r) =>
          r.source === 'voice'
            ? `[Voice session]: ${r.aiResponse}`
            : `Patient: ${r.userMessage}\nAI: ${r.aiResponse}`,
        )
        .join('\n\n')

      // Ask Mistral to summarise
      const result = await this.mistralService.getChatCompletion([
        {
          role: 'system',
          content:
            'You are a medical scribe. Summarise the following conversation history between a cardiovascular patient and an AI health assistant. ' +
            'Write 3–6 bullet points covering: topics discussed, BP/weight values recorded, medication adherence, symptoms mentioned, and any advice given. ' +
            'Be concise. Use plain language. Return only the bullet points, no headings or preamble.',
        },
        { role: 'user', content: historyText },
      ])

      const summary =
        (result.choices?.[0]?.message?.content as string | undefined)?.trim() ?? ''

      // Cache for 5 minutes
      this.summaryCache.set(sessionId, { summary, expiresAt: Date.now() + 5 * 60 * 1000 })

      console.log(`Generated context summary for session ${sessionId}`)
      return summary
    } catch (error) {
      console.error('Error generating context summary:', error)
      return ''
    }
  }
}
