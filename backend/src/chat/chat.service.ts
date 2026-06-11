import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter'
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
import { AlertEngineService } from '../daily_journal/services/alert-engine.service.js'
import { ProfileResolverService } from '../daily_journal/services/profile-resolver.service.js'
import {
  PATIENT_DEVIATION_ALERT_FIELDS_FOR_LLM_PROMPT,
  PATIENT_JOURNAL_FIELDS_FOR_LLM_PROMPT,
} from '../common/prisma-selects.js'
import { GeminiService } from '../gemini/gemini.service.js'
import { OcrService } from '../ocr/ocr.service.js'
import { MedicationAdherenceService } from './services/medication-adherence.service.js'
import { SymptomQuickLogService } from './services/symptom-quick-log.service.js'
import { getJournalToolDeclarations, executeJournalTool } from './tools/journal-tools.js'
import type { JournalToolContext } from './tools/journal-tools.js'
import { IntakeStatusService } from '../intake/intake-status.service.js'
import { INTAKE_EVENTS, type IntakeUpdatedPayload } from '../intake/intake-events.js'
import { EMERGENCY_EVENTS, type EmergencyFlaggedPayload } from './emergency-events.js'

@Injectable()
export class ChatService {
  /**
   * Per-user patient-context cache.
   *
   * `buildPatientSystemPrompt` runs 4 parallel Prisma queries plus
   * ProfileResolver's 3 sub-queries every chat turn — but the underlying
   * data only changes when the patient does a check-in CRUD via our
   * journal tools. So we cache the fully-rendered system-prompt string
   * keyed by userId and invalidate explicitly from the journal-tool
   * executor on saved/updated/deleted/logged. Mirrors the proven pattern
   * in voice.service.ts (line 155-156) — same Map shape, same TTL,
   * same invalidation discipline.
   *
   * Multi-instance staleness is bounded by the 60s TTL — chat sessions
   * have natural affinity to a single backend instance, and a
   * cross-instance mutation worst case shows up to 60s of stale recent-
   * readings context (no clinical risk; the rule engine still fires
   * from actual DB writes, not from cached context).
   *
   * Cache shape note: we store the rendered patient-context block +
   * the patient's timezone, NOT the fully-assembled system prompt. The
   * "CURRENT DATE AND TIME" line at the bottom is re-derived from
   * `new Date()` on every call so a cache hit still gets a fresh
   * timestamp (otherwise the LLM's interpretation of "now"/"today"
   * would lag by up to 60s, including across midnight).
   */
  private readonly contextCache = new Map<string, { patientContext: string; timezone: string; at: number }>()
  private static readonly CONTEXT_TTL_MS = 60_000

  constructor(
    private readonly systemPromptService: SystemPromptService,
    private readonly ragService: RagService,
    private readonly conversationHistoryService: ConversationHistoryService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly dailyJournalService: DailyJournalService,
    private readonly geminiService: GeminiService,
    private readonly profileResolver: ProfileResolverService,
    private readonly ocrService: OcrService,
    private readonly adherenceService: MedicationAdherenceService,
    private readonly symptomQuickLogService: SymptomQuickLogService,
    private readonly alertEngineService: AlertEngineService,
    private readonly intakeStatusService: IntakeStatusService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Drop the cached patient-context for `userId`. Called by the journal-tool
   * executor after every successful CRUD so the next chat turn rebuilds
   * fresh — the newly-saved check-in / adherence log / quick symptom must
   * land in the next prompt's recent-readings block.
   */
  /**
   * Event listener — IntakeService emits `intake.updated` after a successful
   * profile / medication / pregnancy mutation. Drops the cached patient
   * context so the next chat turn sees the new INTAKE STATUS block + fresh
   * resolved conditions / medications without waiting for the 60s TTL.
   */
  @OnEvent(INTAKE_EVENTS.UPDATED)
  onIntakeUpdated(payload: IntakeUpdatedPayload): void {
    this.invalidateContextCache(payload.userId)
  }

  invalidateContextCache(userId: string): void {
    if (this.contextCache.delete(userId)) {
      console.log(`[CHAT cache] invalidated patient context for user=${userId}`)
    }
  }

  /** Phase/27 — bag of services the journal-tools executor needs for the
   *  new adherence / quick-symptom / photo-OCR tools. Built lazily because
   *  the constructor wires the deps; this just packages them. */
  private toolContext(
    userId: string,
    ocrState?: JournalToolContext['ocrState'],
  ): JournalToolContext {
    // Bug 18 — pull the patient's IANA timezone from the per-user context
    // cache populated by buildPatientSystemPrompt at the start of every
    // streaming turn. The cache is guaranteed warm by the time tool
    // dispatch runs (system prompt is built first, then the LLM call, then
    // tools), and the timezone is what submit_checkin / update_checkin use
    // to convert wallclock measurement_time → UTC measuredAt correctly.
    const timezone = this.contextCache.get(userId)?.timezone ?? 'America/New_York'
    return {
      journalService: this.dailyJournalService,
      adherenceService: this.adherenceService,
      symptomService: this.symptomQuickLogService,
      ocrService: this.ocrService,
      alertEngine: this.alertEngineService,
      intakeStatusService: this.intakeStatusService,
      timezone,
      // Bug 13 — caller passes a SHARED mutable ocrState so the same object
      // survives across the multiple toolContext() calls within one
      // streaming turn. submit_bp_from_photo mutates lastAt; the streaming
      // loop flips userMessageSince when a new user turn arrives; the next
      // submit_checkin reads the flag and refuses if unconfirmed.
      ocrState,
      // Mutating tools (submit/update/delete check-in, log adherence, log
      // symptom) call this after a successful write so the next chat turn
      // rebuilds patient context with the fresh row included. Mirrors the
      // voice gateway's invalidateContextCache wiring on its CRUD callbacks.
      onPatientDataMutated: (uid) => this.invalidateContextCache(uid),
    }
  }

  /**
   * Record an emergency event in the database (fire-and-forget).
   */
  /**
   * Prompt-size observability — emits one log line per Gemini call showing
   * the assembled system-prompt size, the contents-array size, and the
   * total. Lets ops tell whether a slow / expensive turn was driven by a
   * bloated prompt (long patient context, long session summary, many
   * tool-result follow-up iterations) without enabling per-call payload
   * logging in Gemini itself. Always on — the line is one short tagged
   * log per turn, cheap to emit and easy to grep.
   */
  private logPromptSize(
    sessionId: string,
    systemPrompt: string,
    contents: Content[],
    historyTurns: number,
  ): void {
    const systemChars = systemPrompt.length
    const contentsChars = JSON.stringify(contents).length
    console.log(
      `[chat.prompt size] sessionId=${sessionId} system=${systemChars} contents_turns=${historyTurns} contents_chars=${contentsChars} total=${systemChars + contentsChars}`,
    )
  }

  /**
   * Persist an EmergencyEvent row AND fan out an emergency.flagged event so
   * EscalationService can page the care team.
   *
   * Bug 10 — was previously fire-and-forget (.then/.catch with void return).
   * If Prisma was briefly down the row was silently lost — patient still got
   * verbal "call 911" from the LLM but ops had no audit trail. Now awaited
   * INSIDE the method; failure logged with the [SECURITY-CRITICAL] prefix
   * ops alerting watches for. Callers still invoke as fire-and-forget so the
   * streaming LLM response isn't blocked on the DB write.
   *
   * Bug 11 — after a successful row insert, emits EMERGENCY_EVENTS.FLAGGED so
   * EscalationService can dispatch caregiver / provider notifications via
   * the existing dispatchCaregiverNotification machinery. Without this the
   * EmergencyEvent row sat in the DB unread; no SMS / email / push fired.
   */
  private async recordEmergencyEvent(
    sessionId: string | null,
    userId: string | null,
    prompt: string,
    emergencySituation: string,
    source: EmergencyFlaggedPayload['source'] = 'chat-tool',
  ): Promise<void> {
    try {
      await this.prisma.emergencyEvent.create({
        data: {
          userId,
          sessionId,
          prompt,
          isEmergency: true,
          emergency_situation: emergencySituation,
        },
      })
      console.log(
        `Recorded emergency event for session ${sessionId}: ${emergencySituation}`,
      )
      // Bug 11 — fan out to EscalationService.onEmergencyFlagged. Only emit
      // when we have a userId — anonymous emergencies (rare; admin sessions
      // hitting chat by accident) have no care team to page.
      if (userId) {
        const payload: EmergencyFlaggedPayload = {
          userId,
          sessionId,
          situation: emergencySituation,
          source,
        }
        this.eventEmitter.emit(EMERGENCY_EVENTS.FLAGGED, payload)
      }
    } catch (error) {
      console.error(
        `[SECURITY-CRITICAL] emergency event persistence failed userId=${userId} sessionId=${sessionId} situation="${emergencySituation}" source=${source} error=${
          (error as Error).message ?? 'unknown'
        }`,
      )
    }
  }

  /**
   * Build patient context part of system prompt (DB queries only, no LLM calls).
   *
   * Per-user cached for CONTEXT_TTL_MS — patient context (recent readings,
   * alerts, profile, meds, thresholds) only changes when the patient writes
   * via our journal tools, and those paths call invalidateContextCache.
   * The "CURRENT DATE AND TIME" tail is always rebuilt fresh so the LLM's
   * interpretation of "now"/"today" never lags.
   */
  private async buildPatientSystemPrompt(userId: string): Promise<string> {
    const basePrompt = this.systemPromptService.buildSystemPrompt({ toneMode: 'PATIENT' })

    if (!userId) return basePrompt

    // Cache fast-path — return rendered prompt without hitting Prisma.
    const cached = this.contextCache.get(userId)
    if (cached && Date.now() - cached.at < ChatService.CONTEXT_TTL_MS) {
      return basePrompt + '\n\n' + cached.patientContext + this.currentDateTimeBlock(cached.timezone)
    }

    let systemPrompt = basePrompt

    // Phase/16 — pull full ResolvedContext from ProfileResolverService (single
    // source of truth, shared with the alert engine) and v2-shape DeviationAlert
    // rows with tier/ruleId/patientMessage/physicianMessage for chat context.
    const [recentEntries, activeAlerts, user, resolvedContext, intakeStatus] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where: { userId },
        orderBy: { measuredAt: 'desc' },
        // Cap at 30 most-recent readings — more than covers the 7-day baseline
        // window while keeping prompt size bounded for long-enrolled patients.
        take: 30,
        select: PATIENT_JOURNAL_FIELDS_FOR_LLM_PROMPT,
      }),
      this.prisma.deviationAlert.findMany({
        where: { userId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: PATIENT_DEVIATION_ALERT_FIELDS_FOR_LLM_PROMPT,
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
      // Cheap PK-scoped findUnique on PatientProfile — mirrors the gate at
      // DailyJournalService.create. Sub-ms; runs in parallel with the four
      // other prompt-context queries.
      this.intakeStatusService.getStatus(userId),
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
      intakeStatus,
      toneMode: 'PATIENT',
    })

    const tz = user?.timezone ?? 'America/New_York'

    // Cache the rendered patient-context block + the patient's timezone so
    // the cheap-rebuild path on cache HIT can attach a fresh timestamp.
    this.contextCache.set(userId, { patientContext, timezone: tz, at: Date.now() })

    systemPrompt = systemPrompt + '\n\n' + patientContext + this.currentDateTimeBlock(tz)
    return systemPrompt
  }

  /**
   * Render the trailing "CURRENT DATE AND TIME …" block in the patient's
   * timezone. Re-derived from `new Date()` on every call so cache hits get
   * a fresh timestamp — the LLM's interpretation of "now"/"today" must
   * never lag, especially across midnight in the patient's TZ.
   */
  private currentDateTimeBlock(tz: string): string {
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
    return `\n\nCURRENT DATE AND TIME (patient timezone ${tz}): ${currentDate} at ${currentTime}. When the patient says "now", "today", or "right now", use EXACTLY this date and time. NEVER guess a different date or time.`
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
    // Captured when the submit_checkin discussion gate blocks. Drives the
    // silent-block fallback below — see the matching block in
    // getStreamingResponse for the longer rationale.
    let blockedCheckinNextAction: string | null = null

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
            blockedCheckinNextAction = gate.missing[0]
            resultStr = JSON.stringify({
              saved: false,
              _internal: true,
              next_action: `Continue asking. Missing: ${gate.missing[0]}`,
            })
          } else {
            resultStr = await executeJournalTool(toolName, toolArgs, this.toolContext(userId), userId)
          }
        } else {
          resultStr = await executeJournalTool(toolName, toolArgs, this.toolContext(userId), userId)
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

    // Silent-block fallback: if submit_checkin was blocked by the discussion
    // gate AND Gemini didn't produce a follow-up question (it sees
    // `_internal: true` and often goes quiet), surface the missing-field
    // prompt ourselves so the patient never hits silence on a "yes" confirm.
    if (!fullText.trim() && blockedCheckinNextAction) {
      fullText =
        'Before I save, let me check one more thing — ' +
        blockedCheckinNextAction
    }

    return { text: fullText, toolResults, emergency }
  }

  /**
   * Stream response token-by-token (SSE) with live Gemini streaming.
   *
   * Tier 1 (parallel, no Gemini calls): DB queries + local embeddings
   * Tier 2 (streaming Gemini call): streamContentWithTools driving the
   *        function-calling loop — text parts yield to the client as they
   *        arrive; function calls at end-of-iteration run tools, then the
   *        next iteration streams through again.
   * Tier 3 (fire-and-forget): saveConversation + title
   */
  async *getStreamingResponse(
    request: ChatRequestDto,
    userId: string,
  ): AsyncIterable<
    | string
    | { type: 'emergency'; emergencySituation: string | null }
    | { type: 'toolResult'; tool: string; result: any }
    | { type: 'hallucinationSuspected'; claim: 'save' | 'update' | 'delete'; excerpt: string }
  > {
    const { prompt } = request
    const sessionId = request.sessionId as string

    try {
      // ── Tier 1: Parallel — DB + local embeddings only, zero Gemini calls ──
      const [basePrompt, sessionSummary, ragDocs, chatHistory] = await Promise.all([
        this.buildPatientSystemPrompt(userId),
        this.conversationHistoryService.getSessionSummary(userId, sessionId),
        this.ragService.retrieveDocuments(prompt, 10),
        this.conversationHistoryService.getConversationHistory(userId, sessionId, prompt),
      ])

      console.log('Chat history turns:', chatHistory.length / 2)

      const systemPrompt = this.assembleSystemPrompt(basePrompt, sessionSummary, ragDocs)
      const contents = this.buildGeminiContents(chatHistory, prompt)

      this.logPromptSize(sessionId, systemPrompt, contents, chatHistory.length / 2)

      // ── Tier 2: Streaming Gemini + function-calling loop ────────────────
      const toolDeclarations = getJournalToolDeclarations()
      let fullResponse = ''
      const toolResultsCollected: Array<{ tool: string; result: any }> = []
      let emergency: EmergencyDetectionResult = { isEmergency: false, emergencySituation: null }
      let emergencyYielded = false
      // Captured when the submit_checkin discussion gate blocks. Drives the
      // silent-block fallback below (if Gemini doesn't generate text after a
      // block, we stream the missing-field question ourselves so the patient
      // never sees silence on a "yes" confirmation).
      let blockedCheckinNextAction: string | null = null

      // Bug 13 — per-turn OCR-confirmation state. Shared mutable object so
      // both submit_bp_from_photo (sets lastAt + clears flag) and
      // submit_checkin (reads flag) see the same instance. Reset on a new
      // patient message — since this streaming call IS a new patient
      // message, userMessageSince starts true (LLM may have called OCR in
      // a PRIOR turn that's now stale-bypassed by the current message).
      const ocrState = { lastAt: 0, userMessageSince: true }

      // Bug 22 Fix 1 — accumulate which write-tools fired across the
      // entire turn (across all 5 internal iterations). Used by the
      // hallucination detector after the tool loop completes.
      const writeToolsCalledThisTurn = new Set<string>()

      for (let iteration = 0; iteration < 5; iteration++) {
        const stream = this.geminiService.streamContentWithTools({
          contents,
          systemInstruction: systemPrompt,
          tools: toolDeclarations,
        })

        let iterationText = ''
        const iterationParts: any[] = []
        const iterationFunctionCalls: any[] = []

        for await (const chunk of stream) {
          const parts = chunk.candidates?.[0]?.content?.parts ?? []
          for (const part of parts) {
            iterationParts.push(part)
            if (part.text) {
              iterationText += part.text
              // Stream raw text fragments to the client the moment they arrive.
              // Guard-pattern stripping runs only on the persisted record —
              // if guards leak to the UI briefly it's a known tradeoff.
              yield part.text
            }
            if (part.functionCall) {
              iterationFunctionCalls.push(part)
            }
          }
        }

        fullResponse += iterationText

        if (iterationFunctionCalls.length === 0) {
          // Final iteration — no more tool calls.
          break
        }

        // Tool calls present: feed the model's response back + execute tools.
        contents.push({ role: 'model', parts: iterationParts })

        const functionResponseParts: any[] = []
        for (const part of iterationFunctionCalls) {
          const fc = part.functionCall
          const toolName = fc.name
          const toolArgs = (fc.args ?? {}) as Record<string, any>

          console.log(`Executing tool: ${toolName}`, JSON.stringify(toolArgs))

          let resultStr: string
          // Bug 22 Fix 1 — track every tool fired this turn. Write tools
          // are correlated against the LLM's text at end-of-turn to catch
          // hallucinated "I saved it" / "I deleted it" with no real call.
          if (toolName) writeToolsCalledThisTurn.add(toolName)

          if (toolName === 'submit_checkin') {
            const gate = ChatService.checkSubmitCheckinDiscussion(contents, toolArgs)
            if (gate.block) {
              console.log(`[submit_checkin BLOCKED] Missing: ${gate.missing.join(', ')}`)
              blockedCheckinNextAction = gate.missing[0]
              resultStr = JSON.stringify({
                saved: false,
                _internal: true,
                next_action: `Continue asking. Missing: ${gate.missing[0]}`,
              })
            } else {
              resultStr = await executeJournalTool(toolName, toolArgs, this.toolContext(userId, ocrState), userId)
            }
          } else {
            resultStr = await executeJournalTool(toolName, toolArgs, this.toolContext(userId, ocrState), userId)
          }

          console.log(`Tool result [${toolName}]:`, resultStr.slice(0, 200))

          if (toolName === 'flag_emergency') {
            emergency = {
              isEmergency: true,
              emergencySituation: toolArgs.emergency_situation ?? 'Emergency detected',
            }
            if (!emergencyYielded) {
              emergencyYielded = true
              yield { type: 'emergency', emergencySituation: emergency.emergencySituation }
              // Bug 10/11 — fire-and-forget at the call site so the LLM
              // stream isn't blocked on the DB write, but the method is now
              // async + awaited internally + emits the .FLAGGED event for
              // care-team escalation.
              void this.recordEmergencyEvent(sessionId, userId, prompt, emergency.emergencySituation!)
            }
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
              const wasBlocked = (toolName === 'submit_checkin' && parsed.saved === false) ||
                                 (toolName === 'update_checkin' && parsed.updated === false)
              if (!wasBlocked) {
                toolResultsCollected.push({ tool: toolName, result: parsed })
                yield { type: 'toolResult', tool: toolName, result: parsed }
              }
            } catch {
              const fallbackResult = { message: resultStr }
              toolResultsCollected.push({ tool: toolName, result: fallbackResult })
              yield { type: 'toolResult', tool: toolName, result: fallbackResult }
            }
          }
        }

        contents.push({ role: 'user', parts: functionResponseParts })
      }

      // Fallback: if a tool succeeded but the model produced no user-facing
      // text, stream a synthesized acknowledgement (mirrors runToolLoop's
      // fallback so the UX matches the structured endpoint).
      if (!fullResponse.trim() && toolResultsCollected.length > 0) {
        let fallback = ''
        for (const tr of toolResultsCollected) {
          if (tr.tool === 'submit_checkin' && tr.result.saved) {
            fallback = `Your check-in has been saved successfully! ${tr.result.message || ''}`
          } else if (tr.tool === 'update_checkin' && tr.result.updated) {
            fallback = `Your reading has been updated successfully! ${tr.result.message || ''}`
          } else if (tr.tool === 'delete_checkin') {
            fallback = tr.result.deleted
              ? `Your reading has been deleted. ${tr.result.message || ''}`
              : `I wasn't able to delete your reading. ${tr.result.message || 'Please try again.'}`
          }
        }
        if (fallback) {
          fullResponse = fallback
          yield fallback
        }
      }

      // Silent-block fallback: if submit_checkin was rejected by the
      // discussion gate AND the LLM produced no follow-up text (it sees
      // `_internal: true` in the function-response and often produces no
      // user-facing text), the patient would see total silence after their
      // "yes". Stream the missing-field question ourselves so the chat
      // never goes quiet on a confirm. After Change 1 (args-only gate)
      // this should fire only on real protocol bugs, but it's the right
      // safety net.
      if (!fullResponse.trim() && blockedCheckinNextAction) {
        const fallback =
          'Before I save, let me check one more thing — ' +
          blockedCheckinNextAction
        fullResponse = fallback
        yield fallback
      }

      // Bug 15 — last-ditch silent-turn fallback. If the two more-specific
      // fallbacks above didn't fire (no tool succeeded, no submit was
      // blocked) but the LLM still produced zero user-facing text, the
      // patient just sent a message and is staring at silence. The
      // commonest trigger is the LLM treating a "yes correct" confirmation
      // as merely acknowledging the summary and forgetting to call
      // submit_checkin — toolResultsCollected stays empty,
      // blockedCheckinNextAction stays null, neither fallback runs. Recover
      // by asking the patient to clarify rather than going silent.
      if (!fullResponse.trim()) {
        const fallback =
          "I want to make sure I got that right — did you mean to confirm and save the reading, " +
          'or did you want to change something first?'
        fullResponse = fallback
        yield fallback
      }

      // Bug 22 Fix 1 — hallucination detector. Worst-case clinical-chat
      // bug: the LLM emits "your reading is saved" / "I've deleted that
      // for you" without firing the matching write tool. Prompt-level
      // guards are real but soft. Here we cross-check at the protocol
      // level: if the assistant text claims a write but no matching
      // tool fired across the whole turn (5 internal iterations
      // included), we log an error and emit a structured event the
      // frontend can use to surface a "I'm not sure that saved — let
      // me check" banner + re-verify via get_recent_readings.
      //
      // Past-tense indicative only — "saving" / "deleting" gerunds
      // don't trigger (the action is still in progress). False
      // positives (e.g. "I saved your preferences earlier") are
      // tolerable; missing a true hallucination on a hypertensive
      // patient is not.
      if (fullResponse.trim()) {
        const saveClaim =
          /\b(?:saved|recorded|logged it)\b|your\s+(?:reading|check[- ]?in)\s+(?:is|has\s+been)\s+(?:saved|recorded|logged)/i
        const updateClaim =
          /\b(?:updated|changed it|edited|modified it)\b|your\s+(?:reading|check[- ]?in)\s+(?:is|has\s+been)\s+updated/i
        const deleteClaim =
          /\b(?:deleted|removed|erased)\b|your\s+(?:reading|check[- ]?in)\s+(?:is|has\s+been)\s+(?:deleted|removed)/i
        const firedSave =
          writeToolsCalledThisTurn.has('submit_checkin') ||
          writeToolsCalledThisTurn.has('finalize_checkin') ||
          writeToolsCalledThisTurn.has('submit_bp_from_photo')
        const firedUpdate = writeToolsCalledThisTurn.has('update_checkin')
        const firedDelete = writeToolsCalledThisTurn.has('delete_checkin')
        let claim: 'save' | 'update' | 'delete' | null = null
        if (saveClaim.test(fullResponse) && !firedSave) claim = 'save'
        else if (updateClaim.test(fullResponse) && !firedUpdate) claim = 'update'
        else if (deleteClaim.test(fullResponse) && !firedDelete) claim = 'delete'
        if (claim) {
          const excerpt = fullResponse.slice(0, 240).replace(/\s+/g, ' ').trim()
          console.error(
            `[CHAT hallucination_suspected] type=${claim} tools=[${[...writeToolsCalledThisTurn].join(',')}] ` +
              `excerpt="${excerpt}" session=${sessionId}`,
          )
          yield { type: 'hallucinationSuspected', claim, excerpt }
        }
      }

      // Strip any leaked internal guard messages from the persisted record
      // (the live stream may have shown them; the saved version is clean).
      const guardPatterns = [
        /You still need to ask the patient about:.*?(?:Ask the next|Do NOT call)/gs,
        /REJECTED:.*?(?:Only call submit_checkin|before saving)/gs,
        /You still need to ask.*?answered\./gs,
        /Ask the next missing question ONE AT A TIME.*?\./g,
        /Do NOT call submit_checkin again until all questions are answered\./g,
      ]
      let cleanedResponse = fullResponse
      for (const pattern of guardPatterns) {
        cleanedResponse = cleanedResponse.replace(pattern, '').trim()
      }

      // ── Tier 3: Save conversation (fire-and-forget after stream closes) ──
      if (cleanedResponse) {
        try {
          await this.conversationHistoryService.saveConversation(sessionId, prompt, cleanedResponse)
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
        this.conversationHistoryService.getSessionSummary(userId, sessionId),
        this.ragService.retrieveDocuments(prompt, 10),
        this.conversationHistoryService.getConversationHistory(userId, sessionId, prompt),
      ])

      console.log('Chat history turns:', chatHistory.length / 2)

      const systemPrompt = this.assembleSystemPrompt(basePrompt, sessionSummary, ragDocs)
      const contents = this.buildGeminiContents(chatHistory, prompt)

      this.logPromptSize(sessionId, systemPrompt, contents, chatHistory.length / 2)

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
        // Bug 10/11 — fire-and-forget at the call site; the method is now
        // async + awaited internally + emits EMERGENCY_EVENTS.FLAGGED for
        // care-team escalation. Source 'detector' covers the upstream
        // EmergencyDetectionService classifier path that sets
        // emergency.isEmergency before any LLM tool call.
        void this.recordEmergencyEvent(
          sessionId,
          userId,
          prompt,
          emergency.emergencySituation!,
          'detector',
        )
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
      // Sidebar renders the 100 most-recent — a heavy patient with hundreds
      // of historical sessions doesn't need every row dumped at once. Older
      // sessions still exist in the DB and can be fetched by id if needed.
      take: 100,
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
    // Tighten the ownership lookup to a composite WHERE so we never read a
    // row we'd otherwise have to reject. Matches the get_recent_readings /
    // update_checkin pattern — foreign sessionId → NotFoundException, no
    // separate "unauthorized" branch needed.
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, ...(userId ? { userId } : {}) },
      select: { id: true },
    })

    if (!session) {
      throw new NotFoundException('Session not found')
    }

    // Defense-in-depth note: the Conversation model exposes only `sessionId`
    // (no relation field on the Prisma client), so we can't add a typed
    // `session: { userId }` filter here. The composite session-ownership
    // check above is the boundary — combined with the JOIN-on-Session raw
    // SQL in ConversationHistoryService.getConversationHistory which scopes
    // the LLM-context lookup path the same way.
    return this.prisma.conversation.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'asc' },
      // Cap at 500 turns — a single session has at most a few dozen
      // exchanges in practice; 500 is well above any real ceiling but
      // prevents unbounded pulls if a session ever grows pathologically.
      take: 500,
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

  async generateSessionTitle(sessionId: string, prompt: string): Promise<string | null> {
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
      return title
    } catch (error) {
      console.error('Error generating session title:', error)
      return null
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
    _contents: readonly Content[],   // kept for API compatibility; no longer read
    toolArgs: Record<string, unknown>,
  ): { block: boolean; missing: string[] } {
    // Args-only check. The earlier version regex-matched the chat history for
    // medication/symptom/weight tokens — that produced silent-failure UX bugs:
    // a confirmed check-in would block on the first "yes" because the regex
    // happened not to find "weight"/"lbs"/"skip" in the previous turns, even
    // when weight was legitimately skipped per the (optional) tool spec.
    // Now we trust the args directly: `medication_taken` and `symptoms` are
    // REQUIRED on the submit_checkin tool spec, so a missing arg means the
    // LLM truly didn't ask. `weight` is OPTIONAL per the spec — never block
    // on it here. journal-tools.ts:574-580 has an inner missing-field gate
    // that produces the same patient-facing instruction text if anything
    // slips through.
    const missing: string[] = []
    if (toolArgs.medication_taken == null) {
      missing.push(
        'medication (ask: "Did you take your medication today?")',
      )
    }
    if (!Array.isArray(toolArgs.symptoms)) {
      missing.push(
        'symptoms (ask: "Any symptoms like headache, dizziness, or chest tightness?")',
      )
    }
    return { block: missing.length > 0, missing }
  }
}
