import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service.js'
import { GeminiService } from '../../gemini/gemini.service.js'
import { EmbeddingService } from '../../common/embedding.service.js'

@Injectable()
export class ConversationHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geminiService: GeminiService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  // ── Retrieval ───────────────────────────────────────────────────────────────

  /**
   * Retrieve the most relevant past messages for a session using vector
   * similarity. Works for both text and voice rows since all have embeddings.
   */
  async getConversationHistory(
    sessionId: string,
    query: string,
  ): Promise<[string, string][]> {
    try {
      if (!sessionId) return []

      type RawRow = { userMessage: string; aiSummary: string; timestamp: Date }

      // 1. Always get the last 12 turns chronologically (ensures recent context)
      const recentRows: RawRow[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT "userMessage", "aiSummary", timestamp
         FROM "Conversation"
         WHERE "sessionId" = $1
         ORDER BY timestamp DESC
         LIMIT 12`,
        sessionId,
      )

      // 2. If query is provided, also get similar turns via vector search
      let similarRows: RawRow[] = []
      if (query?.trim()) {
        try {
          const embeddingResponse = await this.embeddingService.getEmbeddings(query)
          const queryEmbedding = embeddingResponse.data[0]?.embedding
          if (queryEmbedding && queryEmbedding.length > 0) {
            const embeddingString = `[${queryEmbedding.join(',')}]`
            similarRows = await (this.prisma as any).$queryRawUnsafe(
              `SELECT "userMessage", "aiSummary", timestamp
               FROM "Conversation"
               WHERE "sessionId" = $1 AND embedding IS NOT NULL
               ORDER BY embedding <-> $2::vector
               LIMIT 6`,
              sessionId,
              embeddingString,
            )
          }
        } catch {
          // Vector search failed — continue with chronological only
        }
      }

      // 3. Merge and deduplicate
      const seen = new Set<string>()
      const merged: RawRow[] = []
      for (const row of [...recentRows, ...similarRows]) {
        const key = `${new Date(row.timestamp).getTime()}:${row.userMessage.slice(0, 30)}`
        if (!seen.has(key)) {
          seen.add(key)
          merged.push(row)
        }
      }

      // 4. Sort chronologically
      const sorted = merged.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      )

      const history: [string, string][] = []
      for (const row of sorted) {
        history.push(['human', row.userMessage])
        history.push(['ai', row.aiSummary])
      }

      console.log(`Retrieved ${history.length / 2} conversation turns for session ${sessionId} (${recentRows.length} recent, ${similarRows.length} similar)`)
      return history
    } catch (error) {
      console.error('Error retrieving conversation history:', error)
      return []
    }
  }

  /**
   * Read the rolling session summary. One DB read, no LLM call.
   */
  async getSessionSummary(sessionId: string): Promise<string> {
    if (!sessionId) return ''
    try {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { summary: true },
      })
      return session?.summary ?? ''
    } catch {
      return ''
    }
  }

  // ── Saving ──────────────────────────────────────────────────────────────────

  /**
   * Save a text chat turn: summarise the AI response, embed, persist,
   * and incrementally update the session rolling summary.
   */
  async saveConversation(
    sessionId: string,
    userMessage: string,
    rawAiResponse: string,
  ): Promise<void> {
    try {
      if (!userMessage?.trim() && !rawAiResponse?.trim()) return

      const aiSummary = this.summariseText(rawAiResponse)

      // Generate embedding
      const content = `Patient: ${userMessage}\nAI: ${aiSummary}`
      const embeddingResponse = await this.embeddingService.getEmbeddings(content)
      const embedding = embeddingResponse.data[0]?.embedding

      if (embedding && embedding.length > 0) {
        const embeddingString = `[${embedding.join(',')}]`
        await (this.prisma as any).$executeRawUnsafe(
          `INSERT INTO "Conversation" (id, "sessionId", "userMessage", "aiSummary", source, embedding)
           VALUES (gen_random_uuid(), $1, $2, $3, 'text', $4::vector)`,
          sessionId,
          userMessage,
          aiSummary,
          embeddingString,
        )
      } else {
        await (this.prisma as any).$executeRawUnsafe(
          `INSERT INTO "Conversation" (id, "sessionId", "userMessage", "aiSummary", source)
           VALUES (gen_random_uuid(), $1, $2, $3, 'text')`,
          sessionId,
          userMessage,
          aiSummary,
        )
      }

      // Incrementally update the session rolling summary
      await this.updateRollingSummary(sessionId, userMessage, aiSummary, 'text')

      console.log(`Saved text conversation for session ${sessionId}`)
    } catch (error) {
      console.error('Error saving conversation:', error)
    }
  }

  /**
   * Save a voice session turn (already summarised patient + AI parts),
   * generate embedding, and update the session rolling summary.
   */
  async saveVoiceConversation(
    sessionId: string,
    patientSummary: string,
    aiSummary: string,
  ): Promise<void> {
    try {
      const content = `Patient: ${patientSummary}\nAI: ${aiSummary}`
      const embeddingResponse = await this.embeddingService.getEmbeddings(content)
      const embedding = embeddingResponse.data[0]?.embedding

      if (embedding && embedding.length > 0) {
        const embeddingString = `[${embedding.join(',')}]`
        await (this.prisma as any).$executeRawUnsafe(
          `INSERT INTO "Conversation" (id, "sessionId", "userMessage", "aiSummary", source, embedding)
           VALUES (gen_random_uuid(), $1, $2, $3, 'voice', $4::vector)`,
          sessionId,
          patientSummary,
          aiSummary,
          embeddingString,
        )
      } else {
        await (this.prisma as any).$executeRawUnsafe(
          `INSERT INTO "Conversation" (id, "sessionId", "userMessage", "aiSummary", source)
           VALUES (gen_random_uuid(), $1, $2, $3, 'voice')`,
          sessionId,
          patientSummary,
          aiSummary,
        )
      }

      // Incrementally update the session rolling summary
      await this.updateRollingSummary(sessionId, patientSummary, aiSummary, 'voice')

      console.log(`Saved voice conversation for session ${sessionId}`)
    } catch (error) {
      console.error('Error saving voice conversation:', error)
    }
  }

  /**
   * Save individual voice transcript lines as separate Conversation rows
   * (for frontend display) AND update the rolling session summary
   * (for system prompt context).
   */
  async saveVoiceTranscriptLines(
    sessionId: string,
    lines: Array<{ speaker: 'user' | 'agent'; text: string }>,
  ): Promise<void> {
    if (lines.length === 0) return

    try {
      // Group consecutive lines by speaker into turns
      const turns: Array<{ userMessage: string; aiSummary: string }> = []
      let currentUser = ''
      let currentAgent = ''

      for (const line of lines) {
        if (line.speaker === 'user') {
          // If we had agent text, flush the turn
          if (currentAgent) {
            turns.push({ userMessage: currentUser || '[voice]', aiSummary: currentAgent })
            currentUser = ''
            currentAgent = ''
          }
          currentUser += (currentUser ? ' ' : '') + line.text
        } else {
          currentAgent += (currentAgent ? ' ' : '') + line.text
        }
      }
      // Flush remaining
      if (currentUser || currentAgent) {
        turns.push({
          userMessage: currentUser || '[voice]',
          aiSummary: currentAgent || '[voice response]',
        })
      }

      // Save each turn as a Conversation row with embedding
      for (const turn of turns) {
        const content = `Patient: ${turn.userMessage}\nAI: ${turn.aiSummary}`
        let embeddingString: string | null = null
        try {
          const embeddingResponse = await this.embeddingService.getEmbeddings(content)
          const embedding = embeddingResponse.data[0]?.embedding
          if (embedding && embedding.length > 0) {
            embeddingString = `[${embedding.join(',')}]`
          }
        } catch {
          // Continue without embedding
        }

        if (embeddingString) {
          await (this.prisma as any).$executeRawUnsafe(
            `INSERT INTO "Conversation" (id, "sessionId", "userMessage", "aiSummary", source, embedding)
             VALUES (gen_random_uuid(), $1, $2, $3, 'voice', $4::vector)`,
            sessionId,
            turn.userMessage,
            turn.aiSummary,
            embeddingString,
          )
        } else {
          await (this.prisma as any).$executeRawUnsafe(
            `INSERT INTO "Conversation" (id, "sessionId", "userMessage", "aiSummary", source)
             VALUES (gen_random_uuid(), $1, $2, $3, 'voice')`,
            sessionId,
            turn.userMessage,
            turn.aiSummary,
          )
        }
      }

      // Generate a concise LLM summary for the session (not the raw transcript)
      const transcript = turns
        .map((t) => `Patient: ${t.userMessage}\nAI: ${t.aiSummary}`)
        .join('\n')

      let summary: string
      try {
        const result = await this.geminiService.getChatCompletion([
          {
            role: 'system',
            content:
              'You are a medical scribe. Summarise this voice conversation in 3–5 concise bullet points. ' +
              'Preserve specific numbers (BP values, weight, dates). Focus on what the patient reported, ' +
              'what actions were taken (check-ins saved, readings viewed, entries updated/deleted), ' +
              'and any health concerns discussed. Return only bullet points, no preamble.',
          },
          { role: 'user', content: transcript },
        ])
        summary = (result.choices?.[0]?.message?.content as string | undefined)?.trim() ?? ''
      } catch {
        summary = ''
      }

      // Fallback: generate a basic summary from the turns if LLM failed
      if (!summary) {
        summary = turns
          .slice(0, 3)
          .map((t) => `- Patient: ${t.userMessage.slice(0, 80)}`)
          .join('\n')
      }

      // Merge with any existing summary (from action events saved earlier)
      const existing = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { summary: true, messageCount: true },
      })
      const prevSummary = existing?.summary ?? ''
      const mergedSummary = prevSummary && !prevSummary.includes('Voice conversation about cardiovascular health')
        ? prevSummary + '\n' + summary
        : summary

      await this.prisma.session.update({
        where: { id: sessionId },
        data: { summary: mergedSummary, messageCount: (existing?.messageCount ?? 0) + turns.length },
      })

      console.log(`Saved ${turns.length} voice transcript turns for session ${sessionId} with LLM summary`)
    } catch (error) {
      console.error('Error saving voice transcript lines:', error)
      // Even if conversation rows failed, try to save a brief summary
      try {
        const userLines = lines.filter((l) => l.speaker === 'user')
        const topics = userLines.slice(0, 3).map((l) => l.text.slice(0, 60))
        const basicSummary = topics.length > 0
          ? `- Voice conversation topics: ${topics.join('; ')}`
          : '- Voice conversation (transcript save failed)'
        await this.prisma.session.update({
          where: { id: sessionId },
          data: { summary: basicSummary },
        })
        console.log(`[Voice Summary] Fallback summary saved for session ${sessionId}`)
      } catch (fallbackErr) {
        console.error('Fallback summary also failed:', fallbackErr)
      }
    }
  }

  // ── Rolling summary ─────────────────────────────────────────────────────────

  /**
   * Incrementally update Session.summary by appending new exchange.
   * Uses simple truncation to keep size bounded — no LLM call.
   * The LLM-based summary is done lazily only when messageCount hits
   * a threshold (every 10 messages) to save API quota.
   */
  private async updateRollingSummary(
    sessionId: string,
    userMessage: string,
    aiSummary: string,
    source: 'text' | 'voice',
  ): Promise<void> {
    try {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { summary: true, messageCount: true },
      })
      if (!session) return

      const currentSummary = session.summary ?? ''
      const newCount = (session.messageCount ?? 0) + 1
      const label = source === 'voice' ? 'Voice' : 'Text'
      const truncatedAi = aiSummary.length > 200 ? aiSummary.slice(0, 197) + '...' : aiSummary
      const newLine = `- [${label}] Patient: ${userMessage.slice(0, 100)} → AI: ${truncatedAi}`

      let updatedSummary: string

      // Every 10 messages, use LLM to compress the summary
      if (newCount % 10 === 0 && currentSummary.length > 500) {
        try {
          const result = await this.geminiService.getChatCompletion([
            {
              role: 'system',
              content:
                'You are a medical scribe. Compress this chat summary into 4–6 bullet points. ' +
                'Preserve specific numbers (BP values, weight, dates). Return only bullet points.',
            },
            { role: 'user', content: currentSummary + '\n' + newLine },
          ])
          updatedSummary =
            (result.choices?.[0]?.message?.content as string | undefined)?.trim() ?? (currentSummary + '\n' + newLine)
        } catch {
          // LLM failed — just append
          updatedSummary = currentSummary + '\n' + newLine
        }
      } else {
        // Simple append — keep last ~2000 chars
        updatedSummary = currentSummary + '\n' + newLine
        if (updatedSummary.length > 2000) {
          const lines = updatedSummary.split('\n')
          while (updatedSummary.length > 1500 && lines.length > 3) {
            lines.shift()
            updatedSummary = lines.join('\n')
          }
        }
      }

      await this.prisma.session.update({
        where: { id: sessionId },
        data: { summary: updatedSummary, messageCount: newCount },
      })
      console.log(`[Rolling Summary] Updated session ${sessionId} (count=${newCount}, len=${updatedSummary.length})`)
    } catch (error) {
      console.error('[Rolling Summary] FAILED for session', sessionId, error)
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Truncate a long text to a reasonable size for storage.
   * No LLM call — just keeps the first ~300 chars to save API quota.
   */
  private summariseText(text: string): string {
    if (!text) return text
    if (text.length <= 500) return text
    return text.slice(0, 497) + '...'
  }
}
