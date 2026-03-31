import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service.js'
import { MistralService } from '../../mistral/mistral.service.js'

@Injectable()
export class ConversationHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mistralService: MistralService,
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
      if (!query?.trim()) return []

      const embeddingResponse = await this.mistralService.getEmbeddings(query)
      const queryEmbedding = embeddingResponse.data[0]?.embedding
      if (!queryEmbedding) return []

      const embeddingString = `[${queryEmbedding.join(',')}]`

      type RawRow = { userMessage: string; aiSummary: string; timestamp: Date }

      const results: RawRow[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT "userMessage", "aiSummary", timestamp
         FROM "Conversation"
         WHERE "sessionId" = $1 AND embedding IS NOT NULL
         ORDER BY embedding <-> $2::vector
         LIMIT 10`,
        sessionId,
        embeddingString,
      )

      const sorted = [...results].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      )

      const history: [string, string][] = []
      for (const row of sorted) {
        history.push(['human', row.userMessage])
        history.push(['ai', row.aiSummary])
      }

      console.log(`Retrieved ${history.length / 2} conversation turns for session ${sessionId}`)
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

      const aiSummary = await this.summariseText(rawAiResponse, 'ai')

      // Generate embedding
      const content = `Patient: ${userMessage}\nAI: ${aiSummary}`
      const embeddingResponse = await this.mistralService.getEmbeddings(content)
      const embedding = embeddingResponse.data[0]?.embedding

      if (embedding) {
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
      const embeddingResponse = await this.mistralService.getEmbeddings(content)
      const embedding = embeddingResponse.data[0]?.embedding

      if (embedding) {
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

  // ── Rolling summary ─────────────────────────────────────────────────────────

  /**
   * Incrementally update Session.summary by feeding Mistral the current
   * summary + the new exchange. One LLM call per exchange, fixed input size.
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
      const label = source === 'voice' ? 'Voice call' : 'Text chat'

      const newExchange = `[${label}] Patient: ${userMessage}\nAI: ${aiSummary}`

      const result = await this.mistralService.getChatCompletion([
        {
          role: 'system',
          content:
            'You are a medical scribe maintaining a running summary of a cardiovascular patient\'s chat session. ' +
            'You receive the current summary and one new exchange. Produce an updated summary that incorporates the new information. ' +
            'Keep it to 4–8 bullet points. Preserve specific numbers (BP values, weight, dates). ' +
            'Drop older details if the summary gets too long. Return only the bullet points, no headings.',
        },
        {
          role: 'user',
          content: currentSummary
            ? `CURRENT SUMMARY:\n${currentSummary}\n\nNEW EXCHANGE:\n${newExchange}`
            : `FIRST EXCHANGE:\n${newExchange}`,
        },
      ])

      const updatedSummary =
        (result.choices?.[0]?.message?.content as string | undefined)?.trim() ?? currentSummary

      await this.prisma.session.update({
        where: { id: sessionId },
        data: { summary: updatedSummary, messageCount: newCount },
      })
    } catch (error) {
      console.error('Error updating rolling summary:', error)
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Condense a long text (AI response) into 2-3 sentences.
   * Returns the original if it's already short enough (<300 chars).
   */
  private async summariseText(text: string, role: 'ai' | 'patient'): Promise<string> {
    if (!text || text.length < 300) return text

    try {
      const roleLabel = role === 'ai' ? "an AI health assistant's response" : "a patient's message"
      const result = await this.mistralService.getChatCompletion([
        {
          role: 'system',
          content:
            `Summarise ${roleLabel} in 2–3 concise sentences. Preserve any specific numbers ` +
            '(BP values, weight, dates). Return only the summary, no headings.',
        },
        { role: 'user', content: text },
      ])

      return (result.choices?.[0]?.message?.content as string | undefined)?.trim() || text
    } catch {
      return text
    }
  }
}
