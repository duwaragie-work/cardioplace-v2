import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Content } from '@google/genai'
import { ChatRequestDto } from './dto/chat-request.dto.js'
import { SystemPromptService } from './services/system-prompt.service.js'
import { RagService } from './services/rag.service.js'
import { ConversationHistoryService } from './services/conversation-history.service.js'
import type { EmergencyDetectionResult } from './services/emergency-detection.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { DailyJournalService } from '../daily_journal/daily_journal.service.js'
import { GeminiService } from '../gemini/gemini.service.js'
import { getJournalToolDeclarations, executeJournalTool } from './tools/journal-tools.js'

@Injectable()
export class ChatService {
  constructor(
    private readonly systemPromptService: SystemPromptService,
    private readonly ragService: RagService,
    private readonly conversationHistoryService: ConversationHistoryService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly dailyJournalService: DailyJournalService,
    private readonly geminiService: GeminiService,
  ) {}

  /**
   * Record an emergency event in the database (fire-and-forget).
   */
  private recordEmergencyEvent(
    sessionId: string | null,
    userId: string | null,
    prompt: string,
    emergencySituation: string,
  ): void {
    this.prisma.emergencyEvent.create({
      data: {
        userId,
        sessionId,
        prompt,
        isEmergency: true,
        emergency_situation: emergencySituation,
      },
    }).then(() => {
      console.log(`Recorded emergency event for session ${sessionId}: ${emergencySituation}`)
    }).catch((error) => {
      console.error('Error recording emergency event:', error)
    })
  }

  /**
   * Build patient context part of system prompt (DB queries only, no LLM calls).
   */
  private async buildPatientSystemPrompt(userId: string): Promise<string> {
    let systemPrompt = this.systemPromptService.buildSystemPrompt()

    if (!userId) return systemPrompt

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
        orderBy: { computedForDate: 'desc' },
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

    return systemPrompt
  }

  /**
   * Assemble the final system prompt from pre-fetched parts.
   */
  private assembleSystemPrompt(
    basePrompt: string,
    sessionSummary: string,
    ragDocs: Array<{ pageContent: string; metadata: any }>,
  ): string {
    let systemPrompt = basePrompt

    if (sessionSummary) {
      systemPrompt +=
        '\n\n--- CONVERSATION HISTORY SUMMARY ---\n' +
        sessionSummary +
        '\n--- END SUMMARY ---'
    }

    if (ragDocs.length > 0) {
      let ragContext = ''
      ragDocs.forEach((doc, idx) => {
        ragContext += `Document ${idx + 1}:\n${doc.pageContent}\n\n`
      })
      systemPrompt = systemPrompt + '\n\nContext:\n' + ragContext
    }

    return systemPrompt
  }

  /**
   * Build Gemini-format contents from chat history + new user prompt.
   */
  private buildGeminiContents(
    chatHistory: [string, string][],
    prompt: string,
  ): Content[] {
    const contents: Content[] = []

    for (const [role, text] of chatHistory) {
      contents.push({
        role: role === 'human' ? 'user' : 'model',
        parts: [{ text }],
      })
    }

    contents.push({ role: 'user', parts: [{ text: prompt }] })
    return contents
  }

  /**
   * Run the Gemini function-calling loop.
   * Returns final text, tool results, and emergency info (detected via flag_emergency tool).
   */
  private async runToolLoop(
    systemPrompt: string,
    contents: Content[],
    userId: string,
    userMessage?: string,
  ): Promise<{
    text: string
    toolResults: Array<{ tool: string; result: any }>
    emergency: EmergencyDetectionResult
  }> {
    const toolDeclarations = getJournalToolDeclarations()
    const toolResults: Array<{ tool: string; result: any }> = []
    const emergency: EmergencyDetectionResult = { isEmergency: false, emergencySituation: null }
    let fullText = ''

    for (let iteration = 0; iteration < 5; iteration++) {
      const response = await this.geminiService.generateContentWithTools({
        contents,
        systemInstruction: systemPrompt,
        tools: toolDeclarations,
      })

      const parts = response.candidates?.[0]?.content?.parts ?? []
      const textParts = parts.filter((p) => p.text).map((p) => p.text!).join('')
      const functionCalls = parts.filter((p) => p.functionCall)

      if (functionCalls.length === 0) {
        fullText += textParts
        break
      }

      if (textParts) fullText += textParts

      contents.push({ role: 'model', parts })

      const functionResponseParts: any[] = []
      for (const part of functionCalls) {
        const fc = part.functionCall!
        const toolName = fc.name!
        const toolArgs = (fc.args ?? {}) as Record<string, any>

        console.log(`Executing tool: ${toolName}`, JSON.stringify(toolArgs))

        // Guard: before executing submit_checkin, verify the check-in flow
        // was actually followed — BP numbers provided, weight/medication/symptoms asked.
        let resultStr: string
        if (toolName === 'submit_checkin') {
          const allUserText = contents
            .filter((c) => c.role === 'user')
            .flatMap((c) => (c.parts as any[])?.filter((p: any) => p.text).map((p: any) => p.text) ?? [])
            .join(' ')
          const allModelText = contents
            .filter((c) => c.role === 'model')
            .flatMap((c) => (c.parts as any[])?.filter((p: any) => p.text).map((p: any) => p.text) ?? [])
            .join(' ')
            .toLowerCase()

          const hasBPNumbers = /\d{2,3}\s*(\/|and|over|,)\s*\d{2,3}/.test(allUserText)
          const askedDate = /date|when|what day/.test(allModelText)
          const askedTime = /time|when.*taken/.test(allModelText)
          const askedWeight = /weight/.test(allModelText)
          const askedMedication = /medication/.test(allModelText)
          const askedSymptoms = /symptom/.test(allModelText)

          const missingSteps: string[] = []
          if (!askedDate) missingSteps.push('date (ask: "What date is this reading for?")')
          if (!askedTime) missingSteps.push('time (ask: "What time was this reading taken?")')
          if (!hasBPNumbers) missingSteps.push('BP numbers (ask for the systolic/top number and diastolic/bottom number)')
          if (!askedWeight) missingSteps.push('weight (ask: "What is your weight today in pounds? You can skip this if you don\'t know.")')
          if (!askedMedication) missingSteps.push('medication (ask: "Did you take your medication today?")')
          if (!askedSymptoms) missingSteps.push('symptoms (ask: "Any symptoms like headache, dizziness, chest tightness, or shortness of breath?")')

          if (missingSteps.length > 0) {
            console.log(`[submit_checkin BLOCKED] Missing steps: ${missingSteps.join(', ')}`)
            resultStr = JSON.stringify({
              saved: false,
              message:
                `REJECTED: You have not completed the check-in flow. Missing steps: ${missingSteps.join('; ')}. ` +
                'You MUST ask each of these questions and wait for the patient to answer before calling submit_checkin.',
            })
          } else {
            resultStr = await executeJournalTool(toolName, toolArgs, this.dailyJournalService, userId)
          }
        } else if (toolName === 'update_checkin' || toolName === 'delete_checkin') {
          resultStr = await executeJournalTool(toolName, toolArgs, this.dailyJournalService, userId)
        } else {
          resultStr = await executeJournalTool(toolName, toolArgs, this.dailyJournalService, userId)
        }
        console.log(`Tool result [${toolName}]:`, resultStr.slice(0, 200))

        // Detect emergency from flag_emergency tool
        if (toolName === 'flag_emergency') {
          emergency.isEmergency = true
          emergency.emergencySituation = toolArgs.emergency_situation ?? 'Emergency detected'
        }

        functionResponseParts.push({
          functionResponse: {
            name: toolName,
            response: JSON.parse(resultStr),
          },
        })

        if (toolName !== 'flag_emergency') {
          try {
            const parsed = JSON.parse(resultStr)
            // Only add to toolResults if the tool actually succeeded (not rejected)
            if (!parsed.message?.startsWith('REJECTED:')) {
              toolResults.push({ tool: toolName, result: parsed })
            }
          } catch {
            toolResults.push({ tool: toolName, result: { message: resultStr } })
          }
        }
      }

      // Check if any tool calls were rejected and add appropriate hints
      contents.push({ role: 'user', parts: functionResponseParts })
      const rejections = functionResponseParts.filter((p) => {
        const resp = p.functionResponse?.response
        return resp?.message?.startsWith('REJECTED:')
      })
      if (rejections.length > 0) {
        // Check what type of rejection — update/delete needs get_recent_readings first
        const needsReadings = rejections.some((p) =>
          p.functionResponse?.response?.message?.includes('get_recent_readings'),
        )
        if (needsReadings) {
          contents.push({
            role: 'user',
            parts: [{ text: 'The tool call was rejected because you need to call get_recent_readings first. Call get_recent_readings now to get the correct entry IDs, then retry the update or delete with the exact ID from the response.' }],
          })
        } else {
          contents.push({
            role: 'user',
            parts: [{ text: 'The tool call was rejected. Please respond to the patient with a text message asking for the missing information.' }],
          })
        }
      }
    }

    return { text: fullText, toolResults, emergency }
  }

  /**
   * Stream response token-by-token (SSE).
   *
   * Tier 1 (parallel, no Gemini calls): DB queries + local embeddings
   * Tier 2 (single Gemini call): generateContentWithTools (+ emergency via flag_emergency tool)
   * Tier 3 (fire-and-forget): saveConversation + title
   */
  async *getStreamingResponse(
    request: ChatRequestDto,
    userId: string,
  ): AsyncIterable<string | { type: 'emergency'; emergencySituation: string | null }> {
    const { prompt } = request
    const sessionId = request.sessionId as string

    try {
      // ── Tier 1: Parallel — DB + local embeddings only, zero Gemini calls ──
      const [basePrompt, sessionSummary, ragDocs, chatHistory] = await Promise.all([
        this.buildPatientSystemPrompt(userId),
        this.conversationHistoryService.getSessionSummary(sessionId),
        this.ragService.retrieveDocuments(prompt, 10),
        this.conversationHistoryService.getConversationHistory(sessionId, prompt),
      ])

      console.log('Chat history turns:', chatHistory.length / 2)

      const systemPrompt = this.assembleSystemPrompt(basePrompt, sessionSummary, ragDocs)
      const contents = this.buildGeminiContents(chatHistory, prompt)

      // ── Tier 2: Single Gemini call — LLM response + emergency detection via tool ──
      const { text: fullResponse, emergency } = await this.runToolLoop(systemPrompt, contents, userId, prompt)

      if (emergency.isEmergency) {
        yield { type: 'emergency', emergencySituation: emergency.emergencySituation }
        this.recordEmergencyEvent(sessionId, userId, prompt, emergency.emergencySituation!)
      }

      if (fullResponse) {
        const words = fullResponse.split(' ')
        for (let i = 0; i < words.length; i++) {
          yield (i > 0 ? ' ' : '') + words[i]
        }

        // ── Tier 3: Save conversation ──────────────────────────────────────
        try {
          await this.conversationHistoryService.saveConversation(sessionId, prompt, fullResponse)
        } catch (err) {
          console.error('Error saving conversation:', err)
        }
      }

      console.log(`Streaming complete for session ${sessionId}`)
    } catch (error) {
      console.error('Streaming error:', error)
      yield 'An error occurred while getting help'
    }
  }

  /**
   * Return a complete JSON response.
   *
   * Tier 1 (parallel, no Gemini calls): DB queries + local embeddings
   * Tier 2 (single Gemini call): generateContentWithTools (+ emergency via flag_emergency tool)
   * Tier 3 (fire-and-forget): saveConversation + title
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
      // ── Tier 1: Parallel — DB + local embeddings only, zero Gemini calls ──
      const [basePrompt, sessionSummary, ragDocs, chatHistory] = await Promise.all([
        this.buildPatientSystemPrompt(userId),
        this.conversationHistoryService.getSessionSummary(sessionId),
        this.ragService.retrieveDocuments(prompt, 10),
        this.conversationHistoryService.getConversationHistory(sessionId, prompt),
      ])

      console.log('Chat history turns:', chatHistory.length / 2)

      const systemPrompt = this.assembleSystemPrompt(basePrompt, sessionSummary, ragDocs)
      const contents = this.buildGeminiContents(chatHistory, prompt)

      // ── Tier 2: Single Gemini call — LLM response + emergency detection via tool ──
      const { text: responseText, toolResults, emergency } = await this.runToolLoop(systemPrompt, contents, userId, prompt)

      if (emergency.isEmergency) {
        this.recordEmergencyEvent(sessionId, userId, prompt, emergency.emergencySituation!)
      }

      // ── Tier 3: Save conversation before returning ─────────────────────
      // Always save so the user's message appears in history.
      // Use tool result summary as fallback when AI returns no text.
      const saveText = responseText
        || (toolResults.length > 0
          ? toolResults.map((tr) => tr.result?.message || `${tr.tool} completed`).join('. ')
          : prompt)
      try {
        await this.conversationHistoryService.saveConversation(sessionId, prompt, saveText)
      } catch (err) {
        console.error('Error saving conversation:', err)
      }
      console.log(`Structured response complete for session ${sessionId}`)

      return {
        text: responseText,
        isEmergency: emergency.isEmergency,
        emergencySituation: emergency.emergencySituation,
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
        summary: true,
        createdAt: true,
        updatedAt: true,
      },
    })
  }

  async getSession(sessionId: string, userId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, title: true, summary: true, userId: true, createdAt: true, updatedAt: true },
    })
    if (!session) throw new NotFoundException('Session not found')
    if (session.userId && session.userId !== userId) throw new UnauthorizedException('Access denied')
    return session
  }

  async getSessionHistory(sessionId: string, userId?: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    })

    if (!session) {
      throw new NotFoundException('Session not found')
    }

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
      const response = await this.geminiService.getChatCompletion([
        { role: 'system', content: 'You are a helpful assistant. Summarize the user prompt into a short 3-5 word chat title in English. Even if the prompt is in another language, the title MUST be in English. Return ONLY the title, without quotes.' },
        { role: 'user', content: prompt },
      ])

      const title = (response.choices[0]?.message?.content ?? 'New Chat').trim().replace(/^["']|["']$/g, '')

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
