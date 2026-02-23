import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service.js'
import { MistralService } from '../../mistral/mistral.service.js'
import { SystemPromptConfig } from '../dto/system-prompt-config.dto.js'

@Injectable()
export class ConversationHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mistralService: MistralService,
  ) {}

  /**
   * Retrieve the most relevant past messages for a session using vector similarity,
   * then sort chronologically — mirroring ConversationManager from functions/.
   */
  async getConversationHistory(
    sessionId: string,
    query: string,
  ): Promise<[string, string][]> {
    try {
      const embeddingResponse = await this.mistralService.getEmbeddings(query)
      const queryEmbedding = embeddingResponse.data[0]?.embedding
      if (!queryEmbedding) return []

      const embeddingString = `[${queryEmbedding.join(',')}]`

      type RawRow = { userMessage: string; aiResponse: string; timestamp: Date }

      const results: RawRow[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT "userMessage", "aiResponse", timestamp
         FROM "Conversation"
         WHERE "sessionId" = $1
         ORDER BY embedding <-> $2::vector
         LIMIT 10`,
        sessionId,
        embeddingString,
      )

      // Sort chronologically so the LLM sees history in order
      const sorted = [...results].sort(
        (a: RawRow, b: RawRow) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      )

      const history: [string, string][] = []
      for (const row of sorted) {
        history.push(['human', row.userMessage])
        history.push(['ai', row.aiResponse])
      }

      console.log(`Retrieved ${history.length / 2} conversation turns for session ${sessionId}`)
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
}
