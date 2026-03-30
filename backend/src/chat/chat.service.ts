import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ChatMistralAI } from '@langchain/mistralai'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { RunnableSequence, RunnableLambda } from '@langchain/core/runnables'
import { Document } from '@langchain/core/documents'
import { ChatRequestDto } from './dto/chat-request.dto.js'
import { SystemPromptService } from './services/system-prompt.service.js'
import { RagService } from './services/rag.service.js'
import { ConversationHistoryService } from './services/conversation-history.service.js'
import { EmergencyDetectionService, EmergencyDetectionResult } from './services/emergency-detection.service.js'
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
    private readonly emergencyDetectionService: EmergencyDetectionService,
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
   * Build a dedicated chain for emergency situations.
   * This focuses on supportive, non-diagnostic guidance and encourages real-world help.
   */
  private buildEmergencyChain() {
    const apiKey = this.configService.get<string>('MISTRAL_API_KEY')

    const llm = new ChatMistralAI({
      apiKey,
      model: this.chatModel,
      maxTokens: 2048,
      streaming: true,
    })

    const chatPrompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        `You are a compassionate assistant responding to a potential emergency situation.

You are NOT a doctor, therapist, or emergency service, and you must say this clearly.

You receive:
- The original user message describing their situation.
- A short classifier label describing the potential emergency.

Your goals:
- Acknowledge the user's feelings and the seriousness of the situation.
- Make it VERY CLEAR that you cannot provide medical or crisis care.
- Strongly encourage them to seek immediate in-person help from local emergency services,
  medical professionals, or trusted people around them.
- Encourage them to contact appropriate crisis hotlines or local emergency numbers
  if they are in immediate danger.

Do NOT:
- Provide a medical diagnosis.
- Give instructions that could increase harm.
- Minimize or dismiss the seriousness of the situation.

Keep your message short, clear, and supportive.`,
      ],
      [
        'human',
        `Here is the user's original message:\n\n{user_prompt}\n\nClassifier description of the emergency:\n{emergency_situation}\n\nNow respond directly to the user, following all the safety instructions.`,
      ],
    ])

    const chain = RunnableSequence.from([
      {
        user_prompt: RunnableLambda.from((input: { user_prompt: string; emergency_situation: string | null }) => input.user_prompt),
        emergency_situation: RunnableLambda.from((input: { user_prompt: string; emergency_situation: string | null }) =>
          input.emergency_situation ?? 'No additional description provided.',
        ),
      },
      chatPrompt,
      llm,
    ])

    return chain
  }

  /**
   * Run emergency detection and optionally record an emergency event.
   */
  private async preCheckEmergency(
    sessionId: string | null,
    prompt: string,
    userId: string | null,
  ): Promise<EmergencyDetectionResult> {
    const result = await this.emergencyDetectionService.detectEmergency(prompt)

    if (result.isEmergency) {
      try {
        await this.prisma.emergencyEvent.create({
          data: {
            userId,
            sessionId,
            prompt,
            isEmergency: true,
            emergency_situation: result.emergencySituation,
          },
        })
        console.log(`Recorded emergency event for session ${sessionId}: ${result.emergencySituation}`)
      } catch (error) {
        console.error('Error recording emergency event:', error)
      }
    }

    return result
  }

  /**
   * Generate a streaming emergency response tailored to the situation.
   */
  private async *getEmergencyStreamingResponse(
    prompt: string,
    emergencySituation: string | null,
    sessionId: string,
  ): AsyncIterable<string> {
    const chain = this.buildEmergencyChain()
    const stream = await chain.stream({
      user_prompt: prompt,
      emergency_situation: emergencySituation,
    })

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

    // Optionally record the emergency response in the conversation history
    await this.conversationHistoryService.saveConversation(sessionId, prompt, fullResponse, {
      // Mark this as an emergency response; extend config shape as needed.
      emergency: true,
    } as any)
  }

  /**
   * Stream response token-by-token (SSE).
   * Mirrors LangchainService.getStreamingResponse() from functions/.
   */
  async *getStreamingResponse(
    request: ChatRequestDto,
    userId: string,
  ): AsyncIterable<string | { type: 'emergency'; emergencySituation: string | null }> {
    const { prompt, date: _date, ...config } = request
    const sessionId = request.sessionId as string

    try {
      const emergency = await this.preCheckEmergency(sessionId, prompt, userId)
      if (emergency.isEmergency) {
        // First, notify the client that this is an emergency situation.
        yield { type: 'emergency', emergencySituation: emergency.emergencySituation }

        // Then, stream a tailored emergency response.
        for await (const chunk of this.getEmergencyStreamingResponse(
          prompt,
          emergency.emergencySituation,
          sessionId,
        )) {
          yield chunk
        }
        return
      }

      let systemPrompt = this.systemPromptService.buildSystemPrompt()

      if (userId) {
        const [recentEntries, baseline, activeAlerts, user] = await Promise.all([
          this.prisma.journalEntry.findMany({
            where: { userId },
            orderBy: { entryDate: 'desc' },
            take: 7,
            select: {
              entryDate: true, systolicBP: true, diastolicBP: true,
              weight: true, medicationTaken: true,
            },
          }),
          this.prisma.baselineSnapshot.findFirst({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            select: { baselineSystolic: true, baselineDiastolic: true },
          }),
          this.prisma.deviationAlert.findMany({
            where: { userId, acknowledgedAt: null },
            select: { type: true, severity: true },
          }),
          this.prisma.user.findUnique({
            where: { id: userId },
            select: { communicationPreference: true, preferredLanguage: true },
          }),
        ])

        const patientContext = this.systemPromptService.buildPatientContext({
          recentEntries: recentEntries.map((e) => ({
            ...e,
            systolicBP: e.systolicBP != null ? Number(e.systolicBP) : null,
            diastolicBP: e.diastolicBP != null ? Number(e.diastolicBP) : null,
            weight: e.weight != null ? Number(e.weight) : null,
          })),
          baseline: baseline
            ? {
                baselineSystolic: baseline.baselineSystolic != null ? Number(baseline.baselineSystolic) : null,
                baselineDiastolic: baseline.baselineDiastolic != null ? Number(baseline.baselineDiastolic) : null,
              }
            : null,
          activeAlerts,
          communicationPreference: user?.communicationPreference ?? null,
          preferredLanguage: user?.preferredLanguage ?? null,
        })
        systemPrompt = systemPrompt + '\n\n' + patientContext
      }

      // Inject session history summary (covers both text and voice turns)
      const sessionSummary = await this.conversationHistoryService.generateContextSummary(sessionId)
      if (sessionSummary) {
        systemPrompt =
          systemPrompt +
          '\n\n--- CONVERSATION HISTORY SUMMARY ---\n' +
          sessionSummary +
          '\n--- END SUMMARY ---'
      }

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
  async getStructuredResponse(
    request: ChatRequestDto,
    userId: string,
  ): Promise<{ text: string; isEmergency: boolean; emergencySituation: string | null }> {
    const { prompt, date: _date, ...config } = request
    const sessionId = request.sessionId as string

    try {
      const emergency = await this.preCheckEmergency(sessionId, prompt, userId)
      if (emergency.isEmergency) {
        return {
          text: emergency.emergencySituation || '',
          isEmergency: true,
          emergencySituation: emergency.emergencySituation,
        }
      }

      let systemPrompt = this.systemPromptService.buildSystemPrompt()

      if (userId) {
        const [recentEntries, baseline, activeAlerts, user] = await Promise.all([
          this.prisma.journalEntry.findMany({
            where: { userId },
            orderBy: { entryDate: 'desc' },
            take: 7,
            select: {
              entryDate: true, systolicBP: true, diastolicBP: true,
              weight: true, medicationTaken: true,
            },
          }),
          this.prisma.baselineSnapshot.findFirst({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            select: { baselineSystolic: true, baselineDiastolic: true },
          }),
          this.prisma.deviationAlert.findMany({
            where: { userId, acknowledgedAt: null },
            select: { type: true, severity: true },
          }),
          this.prisma.user.findUnique({
            where: { id: userId },
            select: { communicationPreference: true, preferredLanguage: true },
          }),
        ])

        const patientContext = this.systemPromptService.buildPatientContext({
          recentEntries: recentEntries.map((e) => ({
            ...e,
            systolicBP: e.systolicBP != null ? Number(e.systolicBP) : null,
            diastolicBP: e.diastolicBP != null ? Number(e.diastolicBP) : null,
            weight: e.weight != null ? Number(e.weight) : null,
          })),
          baseline: baseline
            ? {
                baselineSystolic: baseline.baselineSystolic != null ? Number(baseline.baselineSystolic) : null,
                baselineDiastolic: baseline.baselineDiastolic != null ? Number(baseline.baselineDiastolic) : null,
              }
            : null,
          activeAlerts,
          communicationPreference: user?.communicationPreference ?? null,
          preferredLanguage: user?.preferredLanguage ?? null,
        })
        systemPrompt = systemPrompt + '\n\n' + patientContext
      }

      // Inject session history summary (covers both text and voice turns)
      const sessionSummary = await this.conversationHistoryService.generateContextSummary(sessionId)
      if (sessionSummary) {
        systemPrompt =
          systemPrompt +
          '\n\n--- CONVERSATION HISTORY SUMMARY ---\n' +
          sessionSummary +
          '\n--- END SUMMARY ---'
      }

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

      return { text: responseText, isEmergency: false, emergencySituation: null }
    } catch (error) {
      console.error('Structured response error:', error)
      return {
        text: 'An error occurred while getting recommendations',
        isEmergency: false,
        emergencySituation: null,
      }
    }
  }

  async getUserSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    })
  }

  async getSessionHistory(sessionId: string, userId?: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    })

    if (!session) {
      throw new NotFoundException('Session not found')
    }

    // Strictly check userId if the session belongs to a registered user
    if (session.userId && session.userId !== userId) {
      throw new UnauthorizedException('Access denied to this session')
    }

    return this.prisma.conversation.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'asc' },
      select: {
        id: true,
        userMessage: true,
        aiResponse: true,
        timestamp: true,
      },
    })
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
