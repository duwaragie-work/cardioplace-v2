import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Content } from '@google/genai'
import {
  getTrailing7DayBaseline,
  ProfileNotFoundException,
  type ResolvedContext,
} from '@cardioplace/shared'
import { ChatRequestDto } from './dto/chat-request.dto.js'
import { SystemPromptService } from './services/system-prompt.service.js'
import { RagService } from './services/rag.service.js'
import { ConversationHistoryService } from './services/conversation-history.service.js'
import type { EmergencyDetectionResult } from './services/emergency-detection.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { DailyJournalService } from '../daily_journal/daily_journal.service.js'
import { ProfileResolverService } from '../daily_journal/services/profile-resolver.service.js'
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
    private readonly profileResolver: ProfileResolverService,
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
    let systemPrompt = this.systemPromptService.buildSystemPrompt({ toneMode: 'PATIENT' })

    if (!userId) return systemPrompt

    // Phase/16 — pull full ResolvedContext from ProfileResolverService (single
    // source of truth, shared with the alert engine) and v2-shape DeviationAlert
    // rows with tier/ruleId/patientMessage/physicianMessage for chat context.
    const [recentEntries, activeAlerts, user, resolvedContext] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where: { userId },
        orderBy: { measuredAt: 'desc' },
        // Cap at 30 most-recent readings — more than covers the 7-day baseline
        // window while keeping prompt size bounded for long-enrolled patients.
        take: 30,
        select: {
          measuredAt: true, systolicBP: true, diastolicBP: true,
          weight: true, medicationTaken: true,
          otherSymptoms: true,
        },
      }),
      this.prisma.deviationAlert.findMany({
        where: { userId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          tier: true,
          ruleId: true,
          mode: true,
          patientMessage: true,
          physicianMessage: true,
          dismissible: true,
          createdAt: true,
        },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true, timezone: true, communicationPreference: true,
          preferredLanguage: true,
          dateOfBirth: true,
        },
      }),
      this.profileResolver.resolve(userId).catch((err: unknown) => {
        if (err instanceof ProfileNotFoundException) return null
        throw err
      }) as Promise<ResolvedContext | null>,
    ])

    // Trailing 7-day mean — single source of truth lives in
    // @cardioplace/shared/derivatives. Voice uses the same helper so the
    // chat and voice agents render identical baselines.
    const baseline = getTrailing7DayBaseline(recentEntries)

    const patientContext = this.systemPromptService.buildPatientContext({
      recentEntries: recentEntries.map((e) => ({
        ...e,
        systolicBP: e.systolicBP != null ? Number(e.systolicBP) : null,
        diastolicBP: e.diastolicBP != null ? Number(e.diastolicBP) : null,
        weight: e.weight != null ? Number(e.weight) : null,
      })),
      baseline,
      activeAlerts: activeAlerts.map((a) => ({
        tier: a.tier ?? 'UNKNOWN',
        ruleId: a.ruleId ?? 'UNKNOWN',
        mode: a.mode ?? 'STANDARD',
        patientMessage: a.patientMessage,
        physicianMessage: a.physicianMessage,
        dismissible: a.dismissible,
        createdAt: a.createdAt,
      })),
      communicationPreference: user?.communicationPreference ?? null,
      preferredLanguage: user?.preferredLanguage ?? null,
      patientName: user?.name ?? null,
      dateOfBirth: user?.dateOfBirth ?? null,
      resolvedContext,
      toneMode: 'PATIENT',
    })

    systemPrompt = systemPrompt + '\n\n' + patientContext

    // Inject current date/time so the AI knows what "now" and "today" mean
    const tz = user?.timezone ?? 'America/New_York'
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const parts = formatter.formatToParts(now)
    const y = parts.find(p => p.type === 'year')?.value
    const mo = parts.find(p => p.type === 'month')?.value
    const d = parts.find(p => p.type === 'day')?.value
    const h = parts.find(p => p.type === 'hour')?.value
    const mi = parts.find(p => p.type === 'minute')?.value
    const currentDate = `${y}-${mo}-${d}`
    const currentTime = `${h}:${mi}`
    systemPrompt += `\n\nCURRENT DATE AND TIME (patient timezone ${tz}): ${currentDate} at ${currentTime}. When the patient says "now", "today", or "right now", use EXACTLY this date and time. NEVER guess a different date or time.`

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

        let resultStr: string

        // Two-layer submit_checkin safety net (see checkSubmitCheckinDiscussion
        // below for the rationale). This call is the outer layer — catches
        // the case where Gemini fabricated values without a prior Q/A exchange.
        // The inner layer in journal-tools.ts:168–184 still enforces that
        // required args are present on the call.
        if (toolName === 'submit_checkin') {
          const gate = ChatService.checkSubmitCheckinDiscussion(contents, toolArgs)
          if (gate.block) {
            console.log(`[submit_checkin BLOCKED] Missing: ${gate.missing.join(', ')}`)
            resultStr = JSON.stringify({
              saved: false,
              _internal: true,
              next_action: `Continue asking. Missing: ${gate.missing[0]}`,
            })
          } else {
            resultStr = await executeJournalTool(toolName, toolArgs, this.dailyJournalService, userId)
          }
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
            // Only add to toolResults if the tool actually succeeded
            // Blocked/rejected calls (saved:false, updated:false from guards) stay internal
            const wasBlocked = (toolName === 'submit_checkin' && parsed.saved === false) ||
                               (toolName === 'update_checkin' && parsed.updated === false)
            if (!wasBlocked) {
              toolResults.push({ tool: toolName, result: parsed })
            }
          } catch {
            toolResults.push({ tool: toolName, result: { message: resultStr } })
          }
        }
      }

      contents.push({ role: 'user', parts: functionResponseParts })
    }

    // Strip any leaked internal guard messages from the AI response
    const guardPatterns = [
      /You still need to ask the patient about:.*?(?:Ask the next|Do NOT call)/gs,
      /REJECTED:.*?(?:Only call submit_checkin|before saving)/gs,
      /You still need to ask.*?answered\./gs,
      /Ask the next missing question ONE AT A TIME.*?\./g,
      /Do NOT call submit_checkin again until all questions are answered\./g,
    ]
    for (const pattern of guardPatterns) {
      fullText = fullText.replace(pattern, '').trim()
    }

    // Ensure tool results always produce a user-facing message
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        if (tr.tool === 'submit_checkin' && tr.result.saved) {
          if (!fullText.trim()) {
            fullText = `Your check-in has been saved successfully! ${tr.result.message || ''}`
          }
        } else if (tr.tool === 'update_checkin' && tr.result.updated) {
          if (!fullText.trim()) {
            fullText = `Your reading has been updated successfully! ${tr.result.message || ''}`
          }
        } else if (tr.tool === 'delete_checkin') {
          if (!fullText.trim()) {
            fullText = tr.result.deleted
              ? `Your reading has been deleted. ${tr.result.message || ''}`
              : `I wasn't able to delete your reading. ${tr.result.message || 'Please try again.'}`
          }
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
      let { text: responseText, toolResults, emergency } = await this.runToolLoop(systemPrompt, contents, userId, prompt)

      // Guard: if AI just echoed the user's exact input, retry once with stronger instruction
      const trimmedResponse = responseText.trim().toLowerCase()
      const trimmedPrompt = prompt.trim().toLowerCase()
      const isExactEcho = trimmedResponse === trimmedPrompt && trimmedResponse.length > 0
      if (isExactEcho && !toolResults.length) {
        console.log(`[AI echo detected] Response "${trimmedResponse}" = prompt "${trimmedPrompt}" — retrying`)
        const retry = await this.runToolLoop(
          systemPrompt + `\n\nThe patient just said: "${prompt}". This is NOT your response — it is the patient's message. You must respond to it naturally. If the patient is confirming something (yes/ok/sure), proceed with the action. If the patient said "now" for time, use the current time and ask the next question.`,
          contents,
          userId,
          prompt,
        )
        if (retry.text.trim().length > 0 || retry.toolResults.length > 0) {
          responseText = retry.text
          toolResults = retry.toolResults
          emergency = retry.emergency
        }
      }

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

  /**
   * Pre-tool-call gate for submit_checkin.
   *
   * Why this exists on top of the journal-tools.ts arg-shape guard:
   * the tool-layer guard (journal-tools.ts:168–184) checks that required
   * args are PRESENT on the function call. This guard checks that the
   * topics were DISCUSSED in the conversation before the save fires. The
   * two catch different model failure modes:
   *   - arg-shape guard catches "model forgot a required arg"
   *   - this discussion guard catches "model fabricated plausible values
   *     without a prior Q/A turn" (Gemini is prone to this if the patient's
   *     first message already contains enough info)
   *
   * Both gates are intentionally layered. Don't remove this without the
   * other layer; don't collapse them without a regression plan.
   *
   * Pure / stateless so it can be unit-tested without constructing the
   * full ChatService.
   */
  static checkSubmitCheckinDiscussion(
    contents: readonly Content[],
    toolArgs: Record<string, unknown>,
  ): { block: boolean; missing: string[] } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allText = contents
      .flatMap(
        (c) =>
          (c.parts as any[])
            ?.filter((p: any) => p.text)
            .map((p: any) => p.text) ?? [],
      )
      .join(' ')

    const hasMedication =
      toolArgs.medication_taken != null ||
      /medication|meds|medicine|pills/.test(allText)
    const hasSymptoms =
      Array.isArray(toolArgs.symptoms) ||
      /symptom|headache|dizziness|chest|no symptom|none|nothing|fine/.test(
        allText,
      )
    const hasWeight =
      toolArgs.weight != null ||
      /weight|weigh|lbs|pounds|skip/.test(allText)

    const missing: string[] = []
    if (!hasMedication) {
      missing.push(
        'medication (ask: "Did you take your medication today?")',
      )
    }
    if (!hasSymptoms) {
      missing.push(
        'symptoms (ask: "Any symptoms like headache, dizziness, or chest tightness?")',
      )
    }
    if (!hasWeight) {
      missing.push(
        'weight (ask: "Do you know your weight today? Totally fine to skip.")',
      )
    }

    return { block: missing.length > 0, missing }
  }
}
