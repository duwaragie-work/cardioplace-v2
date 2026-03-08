import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ChatMistralAI } from '@langchain/mistralai'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { RunnableSequence, RunnableLambda } from '@langchain/core/runnables'
import { Document } from '@langchain/core/documents'
import { ChatRequestDto } from './dto/chat-request.dto.js'
import { SystemPromptService } from './services/system-prompt.service.js'
import { RagService } from './services/rag.service.js'
import { ConversationHistoryService } from './services/conversation-history.service.js'
import { PrismaService } from '../prisma/prisma.service.js'

interface ChainInput {
  input: string
  system_prompt: string
  chat_history: [string, string][]
}

@Injectable()
export class ChatService {
  private chatModel: string

  constructor(
    private readonly systemPromptService: SystemPromptService,
    private readonly ragService: RagService,
    private readonly conversationHistoryService: ConversationHistoryService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.chatModel =
      this.configService.get<string>('MISTRAL_CHAT_MODEL') || 'ministral-3b-2512'
  }

  /**
   * Build the LangChain RAG chain.
   * Mirrors getOutputChain() from functions/src/services/langchain-service.ts
   * but uses pgvector instead of Pinecone.
   */
  private buildChain(chatHistory: [string, string][], streaming: boolean) {
    const apiKey = this.configService.get<string>('MISTRAL_API_KEY')

    const llm = new ChatMistralAI({
      apiKey,
      model: this.chatModel,
      maxTokens: 128000,
      streaming,
    })

    // Build chat prompt template matching functions/ chain shape
    const chatPrompt = ChatPromptTemplate.fromMessages([
      ['system', '{system_prompt}'],
      ...chatHistory,
      ['human', '{input}'],
    ])

    const ragService = this.ragService

    // Use RunnableLambda to avoid TypeScript strict-input-type issues
    const contextRetriever = RunnableLambda.from(async (i: ChainInput) => {
      const ragDocs = await ragService.retrieveDocuments(i.input, 10)
      let formatted = ''
      ragDocs.forEach((doc: Document, idx: number) => {
        formatted += `Document ${idx + 1}:\n${doc.pageContent}\n\n`
      })
      console.log('Context docs count:', ragDocs.length)
      return formatted ? `Context:\n${formatted}` : 'No relevant context found.'
    })

    // Chain: extract inputs → retrieve context → prompt → LLM
    const chain = RunnableSequence.from([
      {
        system_prompt: RunnableLambda.from((i: ChainInput) => i.system_prompt),
        context: contextRetriever,
        input: RunnableLambda.from((i: ChainInput) => i.input),
        chat_history: RunnableLambda.from((i: ChainInput) => i.chat_history),
      },
      chatPrompt,
      llm,
    ])

    return chain
  }

  /**
   * Stream response token-by-token (SSE).
   * Mirrors LangchainService.getStreamingResponse() from functions/.
   */
  async *getStreamingResponse(request: ChatRequestDto): AsyncIterable<string> {
    const { prompt, date: _date, ...config } = request
    const sessionId = request.sessionId as string

    try {
      const systemPrompt = this.systemPromptService.buildSystemPrompt(config)
      const chatHistory = await this.conversationHistoryService.getConversationHistory(
        sessionId,
        prompt,
      )

      console.log('Chat history turns:', chatHistory.length / 2)

      const chain = this.buildChain(chatHistory, true)
      const stream = await chain.stream({
        input: prompt,
        system_prompt: systemPrompt,
        chat_history: chatHistory,
      } as ChainInput)

      let fullResponse = ''

      for await (const chunk of stream) {
        const text: string =
          chunk && typeof chunk === 'object' && 'content' in chunk
            ? (chunk.content as string)
            : typeof chunk === 'string'
              ? chunk
              : ''

        if (text) {
          fullResponse += text
          yield text
        }
      }

      await this.conversationHistoryService.saveConversation(sessionId, prompt, fullResponse, config)
      console.log(`Streaming complete for session ${sessionId}`)
    } catch (error) {
      console.error('Streaming error:', error)
      yield 'An error occurred while getting help'
    }
  }

  /**
   * Return a complete JSON response.
   * Mirrors LangchainService.getStructuredResponse() from functions/.
   */
  async getStructuredResponse(request: ChatRequestDto): Promise<{ text: string }> {
    const { prompt, date: _date, ...config } = request
    const sessionId = request.sessionId as string

    try {
      const systemPrompt = this.systemPromptService.buildSystemPrompt(config)
      const chatHistory = await this.conversationHistoryService.getConversationHistory(
        sessionId,
        prompt,
      )

      console.log('Chat history turns:', chatHistory.length / 2)

      const chain = this.buildChain(chatHistory, false)
      const result = await chain.invoke({
        input: prompt,
        system_prompt: systemPrompt,
        chat_history: chatHistory,
      } as ChainInput)

      console.log('Result:', JSON.stringify(result))

      // Extract text content from LLM response
      let responseText = ''
      if (result && typeof result === 'object' && 'content' in result) {
        responseText = result.content as string
      } else if (typeof result === 'string') {
        responseText = result
      } else {
        responseText = 'An error occurred while generating response'
      }

      await this.conversationHistoryService.saveConversation(sessionId, prompt, responseText, config)
      console.log(`Structured response complete for session ${sessionId}`)

      return { text: responseText }
    } catch (error) {
      console.error('Structured response error:', error)
      return { text: 'An error occurred while getting recommendations' }
    }
  }

  async createSession(sessionId: string, userId?: string): Promise<void> {
    try {
      await this.prisma.session.create({
        data: {
          id: sessionId,
          title: 'New Chat',
          userId: userId || null,
        },
      })
      console.log(`Created new session: ${sessionId}`)
    } catch (error) {
      console.error('Error creating session:', error)
    }
  }

  async generateSessionTitle(sessionId: string, prompt: string): Promise<void> {
    try {
      const apiKey = this.configService.get<string>('MISTRAL_API_KEY')

      const llm = new ChatMistralAI({
        apiKey,
        model: this.chatModel,
        maxTokens: 50,
      })

      const response = await llm.invoke([
        ['system', 'You are a helpful assistant. Summarize the user prompt into a short 3-5 word chat title. Return ONLY the title, without quotes.'],
        ['human', prompt],
      ])

      const title = (response.content as string).trim().replace(/^["']|["']$/g, '')

      await this.prisma.session.update({
        where: { id: sessionId },
        data: { title },
      })
      console.log(`Generated session title for ${sessionId}: ${title}`)
    } catch (error) {
      console.error('Error generating session title:', error)
    }
  }
}
