import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service.js'
import { EmbeddingService } from '../../common/embedding.service.js'

@Injectable()
export class RagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * Retrieve relevant documents from DocumentVector using pgvector similarity search.
   * Replaces the Pinecone ragVectorStore.asRetriever({ k: 10 }) from functions/.
   */
  async retrieveDocuments(query: string, k = 10): Promise<Array<{ pageContent: string; metadata: any }>> {
    try {
      if (!query?.trim()) return []

      const embeddingResponse = await this.embeddingService.getEmbeddings(query)
      const queryEmbedding = embeddingResponse.data[0]?.embedding
      if (!queryEmbedding || queryEmbedding.length === 0) {
        console.warn('Failed to generate embedding for RAG query')
        return []
      }

      const embeddingString = `[${queryEmbedding.join(',')}]`

      type RawRow = { id: string; content: string; documentId: string }

      const results: RawRow[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT id, content, "documentId"
         FROM "DocumentVector"
         WHERE "sourceActiveStatus" = true
         ORDER BY embedding <-> $1::vector
         LIMIT $2`,
        embeddingString,
        k,
      )

      console.log(`RAG: retrieved ${results.length} documents`)

      return results.map((row) => ({
        pageContent: row.content,
        metadata: { id: row.id, documentId: row.documentId },
      }))
    } catch (error) {
      console.error('Error retrieving RAG documents:', error)
      return []
    }
  }
}
