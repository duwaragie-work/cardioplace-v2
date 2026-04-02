import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ChatMistralAI } from '@langchain/mistralai'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { RunnableSequence, RunnableLambda } from '@langchain/core/runnables'
import { Document } from '@langchain/core/documents'
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import { ChatRequestDto } from './dto/chat-request.dto.js'
import { SystemPromptService } from './services/system-prompt.service.js'
import { RagService } from './services/rag.service.js'
import { ConversationHistoryService } from './services/conversation-history.service.js'
import { EmergencyDetectionService, EmergencyDetectionResult } from './services/emergency-detection.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { DailyJournalService } from '../daily_journal/daily_journal.service.js'
import { createJournalTools } from './tools/journal-tools.js'

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
    private readonly dailyJournalService: DailyJournalService,
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

    // Record the emergency response in the conversation history
    await this.conversationHistoryService.saveConversation(sessionId, prompt, fullResponse)
  }

  /**
   * Stream response token-by-token (SSE).
   * Mirrors LangchainService.getStreamingResponse() from functions/.
   */
  async *getStreamingResponse(
    request: ChatRequestDto,
    userId: string,
  ): AsyncIterable<string | { type: 'emergency'; emergencySituation: string | null }> {
    const { prompt } = request
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
            select: { name: true, communicationPreference: true, preferredLanguage: true },
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
        if (user?.name) {
          systemPrompt = systemPrompt + `\n\nPatient name: ${user.name}`
        }
        systemPrompt = systemPrompt + '\n\n' + patientContext
      }

      // Inject rolling session summary (covers both text and voice turns)
      const sessionSummary = await this.conversationHistoryService.getSessionSummary(sessionId)
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

      // RAG context
      const ragDocs = await this.ragService.retrieveDocuments(prompt, 10)
      let ragContext = ''
      ragDocs.forEach((doc: Document, idx: number) => {
        ragContext += `Document ${idx + 1}:\n${doc.pageContent}\n\n`
      })
      if (ragContext) {
        systemPrompt = systemPrompt + '\n\nContext:\n' + ragContext
      }

      // Build tools and LLM with tool binding
      // Do NOT use streaming: true with tool calling — the response must be
      // complete to extract tool_calls correctly.
      const tools = createJournalTools(this.dailyJournalService, userId)
      const apiKey = this.configService.get<string>('MISTRAL_API_KEY')
      const llm = new ChatMistralAI({ apiKey, model: this.chatModel, maxTokens: 4096 })
      const llmWithTools = llm.bindTools(tools, { tool_choice: 'auto' as any })

      // Build message history
      const messages: (SystemMessage | HumanMessage | AIMessage | ToolMessage)[] = [
        new SystemMessage(systemPrompt),
      ]
      for (const [role, text] of chatHistory) {
        if (role === 'human') messages.push(new HumanMessage(text))
        else messages.push(new AIMessage(text))
      }
      messages.push(new HumanMessage(prompt))

      // Tool calling loop — max 5 iterations to prevent infinite loops
      let fullResponse = ''
      for (let iteration = 0; iteration < 5; iteration++) {
        console.log(`Tool loop iteration ${iteration + 1} for session ${sessionId}`)
        const response = await llmWithTools.invoke(messages)
        messages.push(response)

        // Capture any text content the model returned (may come alongside tool calls)
        const textContent = typeof response.content === 'string' ? response.content : ''

        // Check for tool calls
        const toolCalls = response.tool_calls ?? []
        if (toolCalls.length === 0) {
          // No tool calls — this is the final text response, stream it
          if (textContent) {
            fullResponse += textContent
            const words = textContent.split(' ')
            for (let i = 0; i < words.length; i++) {
              yield (i > 0 ? ' ' : '') + words[i]
            }
          }
          break
        }

        // If model returned text alongside tool calls, capture it
        if (textContent) {
          fullResponse += textContent
          const words = textContent.split(' ')
          for (let i = 0; i < words.length; i++) {
            yield (i > 0 ? ' ' : '') + words[i]
          }
        }

        // Execute tool calls and add results to messages
        for (const toolCall of toolCalls) {
          const tool = tools.find((t) => t.name === toolCall.name)
          if (tool) {
            console.log(`Executing tool: ${toolCall.name}`, JSON.stringify(toolCall.args))
            try {
              const result = await tool.invoke(toolCall.args)
              console.log(`Tool result [${toolCall.name}]:`, typeof result === 'string' ? result.slice(0, 200) : result)
              messages.push(new ToolMessage({
                content: typeof result === 'string' ? result : JSON.stringify(result),
                tool_call_id: toolCall.id ?? toolCall.name,
              }))
            } catch (toolErr) {
              console.error(`Tool execution failed [${toolCall.name}]:`, toolErr)
              messages.push(new ToolMessage({
                content: JSON.stringify({ error: true, message: String(toolErr) }),
                tool_call_id: toolCall.id ?? toolCall.name,
              }))
            }
          } else {
            console.warn(`Unknown tool requested: ${toolCall.name}`)
            messages.push(new ToolMessage({
              content: JSON.stringify({ error: true, message: `Unknown tool: ${toolCall.name}` }),
              tool_call_id: toolCall.id ?? toolCall.name,
            }))
          }
        }
        // Loop continues — LLM will see tool results and generate next response
      }

      if (fullResponse) {
        await this.conversationHistoryService.saveConversation(sessionId, prompt, fullResponse)
      }
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
  ): Promise<{
    text: string
    isEmergency: boolean
    emergencySituation: string | null
    toolResults?: Array<{ tool: string; result: any }>
  }> {
    const { prompt } = request
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
            select: { name: true, communicationPreference: true, preferredLanguage: true },
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
        if (user?.name) {
          systemPrompt = systemPrompt + `\n\nPatient name: ${user.name}`
        }
        systemPrompt = systemPrompt + '\n\n' + patientContext
      }

      // Inject rolling session summary (covers both text and voice turns)
      const sessionSummary = await this.conversationHistoryService.getSessionSummary(sessionId)
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

      // RAG context
      const ragDocs = await this.ragService.retrieveDocuments(prompt, 10)
      let ragContext = ''
      ragDocs.forEach((doc: Document, idx: number) => {
        ragContext += `Document ${idx + 1}:\n${doc.pageContent}\n\n`
      })
      if (ragContext) {
        systemPrompt = systemPrompt + '\n\nContext:\n' + ragContext
      }

      // Build tools and LLM with tool binding
      const tools = createJournalTools(this.dailyJournalService, userId)
      const apiKey = this.configService.get<string>('MISTRAL_API_KEY')
      const llm = new ChatMistralAI({ apiKey, model: this.chatModel, maxTokens: 4096 })
      const llmWithTools = llm.bindTools(tools, { tool_choice: 'auto' as any })

      // Build message history
      const messages: (SystemMessage | HumanMessage | AIMessage | ToolMessage)[] = [
        new SystemMessage(systemPrompt),
      ]
      for (const [role, text] of chatHistory) {
        if (role === 'human') messages.push(new HumanMessage(text))
        else messages.push(new AIMessage(text))
      }
      messages.push(new HumanMessage(prompt))

      // Tool calling loop
      let responseText = ''
      const toolResults: Array<{ tool: string; result: any }> = []

      for (let iteration = 0; iteration < 5; iteration++) {
        const response = await llmWithTools.invoke(messages)
        messages.push(response)

        const textContent = typeof response.content === 'string' ? response.content : ''
        const toolCalls = response.tool_calls ?? []

        if (toolCalls.length === 0) {
          if (textContent) responseText += textContent
          break
        }

        // Capture text returned alongside tool calls
        if (textContent) responseText += textContent

        for (const toolCall of toolCalls) {
          const tool = tools.find((t) => t.name === toolCall.name)
          if (tool) {
            console.log(`Executing tool [structured]: ${toolCall.name}`, JSON.stringify(toolCall.args))
            try {
              const rawResult = await tool.invoke(toolCall.args)
              const resultStr = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult)
              console.log(`Tool result [${toolCall.name}]:`, resultStr.slice(0, 200))
              messages.push(new ToolMessage({
                content: resultStr,
                tool_call_id: toolCall.id ?? toolCall.name,
              }))
              try {
                toolResults.push({ tool: toolCall.name, result: JSON.parse(resultStr) })
              } catch {
                toolResults.push({ tool: toolCall.name, result: { message: resultStr } })
              }
            } catch (toolErr) {
              console.error(`Tool execution failed [${toolCall.name}]:`, toolErr)
              messages.push(new ToolMessage({
                content: JSON.stringify({ error: true, message: String(toolErr) }),
                tool_call_id: toolCall.id ?? toolCall.name,
              }))
            }
          } else {
            console.warn(`Unknown tool requested: ${toolCall.name}`)
            messages.push(new ToolMessage({
              content: JSON.stringify({ error: true, message: `Unknown tool: ${toolCall.name}` }),
              tool_call_id: toolCall.id ?? toolCall.name,
            }))
          }
        }
      }

      if (responseText) {
        await this.conversationHistoryService.saveConversation(sessionId, prompt, responseText)
      }
      console.log(`Structured response complete for session ${sessionId}`)

      return {
        text: responseText,
        isEmergency: false,
        emergencySituation: null,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
      }
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
        aiSummary: true,
        source: true,
        timestamp: true,
      },
    })
  }

  async deleteSession(sessionId: string, userId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } })
    if (!session) throw new NotFoundException('Session not found')
    if (session.userId && session.userId !== userId) throw new UnauthorizedException('Access denied')

    // Delete conversations first, then the session
    await this.prisma.conversation.deleteMany({ where: { sessionId } })
    await this.prisma.session.delete({ where: { id: sessionId } })
    return { statusCode: 200, message: 'Session deleted' }
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
        ['system', 'You are a helpful assistant. Summarize the user prompt into a short 3-5 word chat title in English. Even if the prompt is in another language, the title MUST be in English. Return ONLY the title, without quotes.'],
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
