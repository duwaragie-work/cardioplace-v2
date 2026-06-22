import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OnEvent } from '@nestjs/event-emitter'
import { GoogleGenAI, Modality } from '@google/genai'
import type { Session, LiveServerMessage, FunctionResponse } from '@google/genai'
import { trace, SpanStatusCode } from '@opentelemetry/api'
import { randomUUID } from 'node:crypto'

const tracer = trace.getTracer('cardioplace.voice')
import {
  getTrailing7DayBaseline,
  ProfileNotFoundException,
  type ResolvedContext,
} from '@cardioplace/shared'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  PATIENT_DEVIATION_ALERT_FIELDS_FOR_LLM_PROMPT,
  PATIENT_JOURNAL_FIELDS_FOR_LLM_PROMPT,
} from '../common/prisma-selects.js'
import { ConversationHistoryService } from '../chat/services/conversation-history.service.js'
import { SystemPromptService } from '../chat/services/system-prompt.service.js'
import { ProfileResolverService } from '../daily_journal/services/profile-resolver.service.js'
import { GeminiService } from '../gemini/gemini.service.js'
import { IntakeStatusService } from '../intake/intake-status.service.js'
import { INTAKE_EVENTS, type IntakeUpdatedPayload } from '../intake/intake-events.js'
import { JOURNAL_EVENTS } from '../daily_journal/constants/events.js'
import { VoiceToolsService } from './tools/voice-tools.service.js'
import type { ToolEvent } from './tools/voice-tools.service.js'
import { buildVoiceSystemInstruction } from './prompts/voice-system-instruction.js'

export interface VoiceSessionCallbacks {
  onReady: () => void
  onAudio: (audioBase64: string) => void
  onTranscript: (text: string, isFinal: boolean, speaker: 'user' | 'agent') => void
  /**
   * Fires when Gemini sets `serverContent.generationComplete = true` — the
   * canonical "model is done producing audio for this response" signal per
   * https://ai.google.dev/gemini-api/docs/live-api/best-practices. The
   * frontend uses this as the deterministic end-of-agent-turn gate; without
   * it the only fallback is a noisy silence-based drain timer that flaps
   * mid-sentence on real-world inter-chunk jitter.
   *
   * NOTE: we deliberately do NOT forward `serverContent.turnComplete` — it
   * fires prematurely mid-sentence on native-audio models (see
   * https://github.com/googleapis/python-genai/issues/2117, ~40 reports,
   * P2 unfixed). turnComplete still drives transcript-finalisation inline
   * inside voice.service.ts; it just never reaches the client.
   */
  onGenerationComplete: () => void
  /**
   * Fires when Gemini sets `serverContent.interrupted = true` (user barge-in
   * or model self-interrupt). Per Live API docs the client MUST immediately
   * discard its audio buffer — the frontend closes the AudioContext on
   * receipt so no queued chunks keep playing after the patient starts talking.
   */
  onInterrupted: () => void
  onAction: (type: string, detail: string) => void
  onActionComplete: (type: string, success: boolean, detail: string) => void
  onCheckinSaved: (summary: CheckinSummary) => void
  onCheckinUpdated: (summary: UpdateSummary) => void
  onCheckinDeleted: (summary: DeleteSummary) => void
  /**
   * Bug 22 Fix 1 — fires when the agent's transcript claimed a write
   * (saved / updated / deleted) for the current turn but the matching
   * write tool was NOT actually invoked. Frontend should surface a
   * "I'm not sure that saved — let me check" banner and, for save claims,
   * trigger get_recent_readings to verify whether the entry actually
   * landed. Per-turn, fires at most once. Optional — backend logs an
   * error regardless so the gap is captured in telemetry.
   */
  onHallucinationSuspected?: (claim: 'save' | 'update' | 'delete', transcriptExcerpt: string) => void
  onError: (message: string) => void
  onClose: () => void
}

export interface CheckinSummary {
  systolicBP?: number
  diastolicBP?: number
  weight?: number
  medicationTaken?: boolean
  symptoms: string[]
  saved: boolean
  /**
   * Bug 60 — whether the patient has ANY active (non-discontinued,
   * non-rejected, non-PRN) medications on file. When false, frontend
   * renderers (CheckinCard popup, verbal audio summary, My Readings card)
   * SUPPRESS the medication label entirely — otherwise the vacuously-true
   * `medicationTaken=true` we save for 0-meds patients (per Bug 53) gets
   * rendered as the misleading "All medications taken ✓" pill.
   */
  hasActiveMedications?: boolean
}

export interface UpdateSummary {
  entryId: string
  entryDate?: string
  systolicBP?: number
  diastolicBP?: number
  weight?: number
  medicationTaken?: boolean
  symptoms: string[]
  updated: boolean
  /** Bug 60 — see CheckinSummary.hasActiveMedications. */
  hasActiveMedications?: boolean
}

export interface DeleteSummary {
  entryIds: string[]
  deletedCount: number
  failedCount: number
  success: boolean
  message: string
}

interface TranscriptEntry {
  speaker: 'user' | 'agent'
  text: string
}

interface SessionActivity {
  userTexts: string[]
  agentTexts: string[]
  checkins: CheckinSummary[]
  actions: Array<{ type: string; detail: string; timestamp: number }>
}

// Max audio buffer: ~10 minutes at 16kHz 16-bit mono = ~19.2MB
const MAX_AUDIO_BYTES = 20 * 1024 * 1024

/**
 * Validate that a string is a real IANA timezone identifier by feeding it to
 * Intl.DateTimeFormat — which throws RangeError on unknown zones. Used to
 * sanity-check the `clientTimezone` payload before trusting it to interpret
 * patient measuredAt values. (We can't blindly use Prisma.user.update with
 * arbitrary attacker-controlled strings.)
 */
function isValidIanaTz(tz: string | undefined): boolean {
  if (!tz || typeof tz !== 'string') return false
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

interface ActiveSession {
  liveSession: Session
  userId: string
  sessionId: string
  timezone: string
  transcriptBuffer: TranscriptEntry[]
  activity: SessionActivity
  callbacks: VoiceSessionCallbacks
  savedTranscript: boolean
  streamClosed: boolean
  closedNotified: boolean
  userAudioChunks: Buffer[]
  agentAudioChunks: Buffer[]
  userAudioBytes: number
  agentAudioBytes: number
  // Latency — stamp (Date.now) when the user's final transcript arrives,
  // logged again on the next agent audio chunk to measure round-trip time.
  // Null until the next user turn; cleared after one measurement.
  lastUserFinalAt: number | null
  // Diagnostic: count of audio chunks forwarded to Gemini Live this
  // session. Surfaced every 25 chunks under VOICE_DEBUG_AUDIO=1 so we
  // can see audio is flowing when troubleshooting "listening forever".
  userAudioChunkCount: number
  // Bug 22 Fix 1 — per-turn state used by the hallucination detector.
  // currentTurnAgentText accumulates the agent's transcript chunks for
  // the in-progress turn; currentTurnWriteToolsCalled tracks which
  // write-tools (submit/update/delete/finalize) the model actually
  // invoked in the same turn. On turnComplete we compare the two: if
  // the agent claimed a save/update/delete without firing the matching
  // tool, the model is hallucinating the action. State resets after
  // each turnComplete so consecutive turns are scored independently.
  currentTurnAgentText: string
  currentTurnWriteToolsCalled: Set<string>
  hallucinationFlaggedThisTurn: boolean
}

@Injectable()
export class VoiceService implements OnModuleDestroy {
  private readonly logger = new Logger(VoiceService.name)
  private readonly sessions = new Map<string, ActiveSession>()
  // Per-user patient-context cache. The 3s DB aggregation in
  // buildPatientContext dominates first-turn latency; pre-warmed sessions and
  // back-to-back sessions can reuse the last build within CONTEXT_TTL_MS.
  // Invalidated on any CRUD action so readings/baseline stay fresh.
  private readonly contextCache = new Map<string, { value: string; at: number }>()
  private static readonly CONTEXT_TTL_MS = 60_000

  // Default to a Live-capable model. Override via GEMINI_VOICE_MODEL.
  private readonly voiceModel: string
  // Dedicated GoogleGenAI client pinned to v1alpha for Live API. The shared
  // `GeminiService.clientInstance` defaults to v1beta (for text/embeddings
  // /OCR) where Live's bidiGenerateContent isn't exposed — caused the
  // "model not found for API version v1beta" error. v1alpha is the
  // documented Live endpoint on the Gemini Developer API (AI Studio key).
  private readonly liveClient: GoogleGenAI

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly conversationHistory: ConversationHistoryService,
    private readonly geminiService: GeminiService,
    private readonly systemPromptService: SystemPromptService,
    private readonly profileResolver: ProfileResolverService,
    private readonly voiceTools: VoiceToolsService,
    private readonly intakeStatusService: IntakeStatusService,
  ) {
    // Default to a Live-capable model verified present via ListModels on
    // the Gemini Developer API. `gemini-2.5-flash-native-audio-preview-
    // 09-2025` exposes bidiGenerateContent and produces native-audio
    // output (better voice quality vs. cascading models). Override via
    // GEMINI_VOICE_MODEL env var.
    this.voiceModel =
      this.config.get<string>('GEMINI_VOICE_MODEL') ??
      'gemini-2.5-flash-native-audio-preview-09-2025'
    const apiKey = this.config.getOrThrow<string>('GOOGLE_API_KEY')
    this.liveClient = new GoogleGenAI({
      apiKey,
      apiVersion: 'v1alpha',
    })
  }

  /** Convert raw PCM buffers to a WAV file (adds 44-byte header). */
  private pcmToWav(pcmBuffers: Buffer[], sampleRate: number, channels = 1, bitsPerSample = 16): Buffer {
    const pcm = Buffer.concat(pcmBuffers)
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + pcm.length, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(channels, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28)
    header.writeUInt16LE(channels * bitsPerSample / 8, 32)
    header.writeUInt16LE(bitsPerSample, 34)
    header.write('data', 36)
    header.writeUInt32LE(pcm.length, 40)
    return Buffer.concat([header, pcm])
  }

  async createSession(
    socketId: string,
    userId: string,
    callbacks: VoiceSessionCallbacks,
    _authToken = '',
    chatSessionId?: string,
    clientTimezone?: string,
  ): Promise<void> {
    // _authToken is preserved in the public signature for backwards-compat
    // with the gateway; unused now that voice tools call services directly
    // (no internal HTTP loopback).
    void _authToken
    const t0 = Date.now()
    // Clean up any existing session for this socket
    await this.endSession(socketId)

    // Resolve or create a chat session for this voice interaction
    const sessionId = await this.resolveSession(chatSessionId, userId)
    this.logger.log(`[FLOW] Step 3a — session resolved [${sessionId}] (${Date.now() - t0}ms)`)

    // Use cached context if fresh; otherwise rebuild + store. CRUD tool
    // events invalidate via invalidateContextCache(userId).
    const cached = this.contextCache.get(userId)
    let patientContext: string
    if (cached && Date.now() - cached.at < VoiceService.CONTEXT_TTL_MS) {
      patientContext = cached.value
      this.logger.log(`[FLOW] Step 3b — patient context cache HIT (${Date.now() - t0}ms)`)
    } else {
      patientContext = await this.buildPatientContext(userId, sessionId)
      this.contextCache.set(userId, { value: patientContext, at: Date.now() })
      this.logger.log(`[FLOW] Step 3b — patient context built + cached (${Date.now() - t0}ms)`)
    }

    // Resolve patient timezone — used by voice tools to interpret "now".
    // Priority order:
    //   1. clientTimezone (IANA TZ from Intl.DateTimeFormat in the browser
    //      that just opened this session) — captures travel + region drift
    //      that the stored User row would miss.
    //   2. User.timezone (stored on the row, set at signup or via admin).
    //   3. America/New_York default.
    // A patient who travels to PT but signed up in ET should get PT
    // wall-clock on their voice check-ins; the browser-detected value is
    // the only ground-truth source for that.
    const browserTz =
      typeof clientTimezone === 'string' && isValidIanaTz(clientTimezone)
        ? clientTimezone
        : null
    const userRow = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    })
    const timezone = browserTz ?? userRow?.timezone ?? 'America/New_York'
    this.logger.log(
      `[TIMEZONE] user=${userId} browser=${clientTimezone ?? 'null'} stored=${userRow?.timezone ?? 'null'} using=${timezone}`,
    )

    // Opportunistic backfill: if the browser told us a TZ that disagrees with
    // the User row, persist it. Keeps non-voice surfaces (admin views,
    // escalation cron, scheduled reports) consistent with the patient's
    // current location. Fire-and-forget — a failure here MUST NOT block
    // session creation. Also bust the patient-context cache so the next
    // build picks up the corrected TZ (the cached prompt was rendered with
    // the stale value, which would land the wrong "today is" in the LLM
    // prompt for date-relative reasoning).
    if (browserTz && browserTz !== userRow?.timezone) {
      this.prisma.user
        .update({ where: { id: userId }, data: { timezone: browserTz } })
        .catch((err) =>
          this.logger.warn(`[TIMEZONE] User.timezone backfill failed: ${(err as Error).message}`),
        )
      this.invalidateContextCache(userId)
    }

    // ── Open Gemini Live session (Step 4 — replaces ADK gRPC stream) ──
    // Use the dedicated v1alpha client (see constructor). The shared
    // `GeminiService.clientInstance` is on v1beta for text/OCR/embeddings.
    const client = this.liveClient
    // B.4 — resolve the v2 flag via ConfigService (same source + exact
    // `=== 'true'` check as the text chat) so voice and text never drift.
    const v2Enabled =
      this.config.get<string>('CHAT_V2_PROMPT_ENABLED') === 'true'
    const systemInstruction = buildVoiceSystemInstruction(
      patientContext,
      v2Enabled,
    )

    // Span covers just the connect handshake. The session itself is long-
    // lived; per-tool spans are recorded inside handleLiveEvent.
    const connectSpan = tracer.startSpan('voice.session.connect', {
      attributes: {
        'voice.user.id': userId,
        'voice.session.id': sessionId,
        'voice.model': this.voiceModel,
      },
    })

    let liveSession: Session
    try {
      liveSession = await client.live.connect({
        model: this.voiceModel,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          speechConfig: { languageCode: 'en-US' },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: this.voiceTools.getToolDeclarations() }],
        },
        callbacks: {
          onopen: () => {
            this.logger.log(`[FLOW] Step 4 — Gemini Live session opened (${Date.now() - t0}ms)`)
            callbacks.onReady()
          },
          onmessage: (msg: LiveServerMessage) => {
            this.handleLiveEvent(msg, socketId)
          },
          onerror: (err: ErrorEvent) => {
            this.logger.error(`[VOICE Live] error: ${err.message ?? 'unknown'} [socket=${socketId}]`, err)
            const sess = this.sessions.get(socketId)
            if (sess) {
              sess.streamClosed = true
              this.saveVoiceTranscript(socketId).then(() => {
                this.sessions.delete(socketId)
                callbacks.onError('Voice service connection lost. Please try again.')
              })
            }
          },
          onclose: (e: CloseEvent) => {
            const reason = e.reason ?? ''
            const code = e.code ?? 0
            this.logger.log(
              `[VOICE Live] closed code=${code} reason="${reason}" [socket=${socketId}]`,
            )
            const sess = this.sessions.get(socketId)
            if (!sess) return
            sess.streamClosed = true
            this.saveVoiceTranscript(socketId).then(() => {
              this.sessions.delete(socketId)
              if (!sess.closedNotified) {
                sess.closedNotified = true
                // If Gemini Live closed with a non-normal reason (quota
                // exhausted, model rejected request, network error, etc.),
                // surface it as session_error so the patient sees an
                // actionable message instead of a silent hung orb.
                // Code 1000 = normal closure; anything else is unexpected.
                const isAbnormal =
                  code !== 0 &&
                  code !== 1000 &&
                  code !== 1005 // 1005 = no status code (also benign)
                if (isAbnormal) {
                  callbacks.onError(
                    `Voice service closed unexpectedly${reason ? ` (${reason})` : ''}. Please try again.`,
                  )
                } else {
                  callbacks.onClose()
                }
              }
            })
          },
        },
      })
    } catch (err) {
      connectSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error).message,
      })
      connectSpan.end()
      this.logger.error(`[FLOW] Step 4 FAIL — Gemini Live connect failed (${Date.now() - t0}ms)`, err)
      callbacks.onError('Could not connect to voice service. Please try again.')
      return
    }
    connectSpan.end()

    const activeSession: ActiveSession = {
      liveSession,
      userId,
      sessionId,
      timezone,
      transcriptBuffer: [],
      activity: { userTexts: [], agentTexts: [], checkins: [], actions: [] },
      savedTranscript: false,
      streamClosed: false,
      closedNotified: false,
      userAudioChunks: [],
      agentAudioChunks: [],
      userAudioBytes: 0,
      agentAudioBytes: 0,
      lastUserFinalAt: null,
      userAudioChunkCount: 0,
      currentTurnAgentText: '',
      currentTurnWriteToolsCalled: new Set(),
      hallucinationFlaggedThisTurn: false,
      callbacks,
    }
    this.sessions.set(socketId, activeSession)

    this.logger.log(`Voice session started [socket=${socketId}, user=${userId}, chatSession=${sessionId}, model=${this.voiceModel}]`)

    // Force Gemini to emit its first turn now. The system instruction's
    // "GREET FIRST — UNPROMPTED" block tells it WHAT to say; this synthetic
    // "[Session started]" user turn tells it WHEN. The prompt explicitly
    // mentions this cue: "If you also receive a '[Session started]' message,
    // treat it as a redundant cue, not a requirement." Native-audio models
    // reject empty turnComplete pings ("Request contains an invalid argument"),
    // so we send a real text turn instead. Non-fatal — patient can still
    // drive the conversation by speaking if this fails.
    try {
      liveSession.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: '[Session started]' }] }],
        turnComplete: true,
      })
      this.logger.log(`[FLOW] Step 4b — greeting trigger sent`)
    } catch (err) {
      this.logger.warn(`[VOICE] greeting trigger failed: ${(err as Error).message}`)
    }
  }

  /**
   * Demux a `LiveServerMessage` into Socket.io fan-out events. Mirrors the
   * old gRPC handler: setup → ready, audio chunks → onAudio, transcripts →
   * onTranscript (with latency stamping), tool calls → voiceTools.dispatch
   * → sendToolResponse(...).
   */
  private async handleLiveEvent(msg: LiveServerMessage, socketId: string): Promise<void> {
    const session = this.sessions.get(socketId)
    if (!session || session.streamClosed) return
    const { callbacks } = session

    // Diagnostic: trace every Live event when VOICE_DEBUG_AUDIO=1. Helps
    // identify silent failures where Gemini stops responding mid-session.
    // The "listening forever" bug was diagnosed using this — chunks
    // forwarded but no events arriving meant Gemini wasn't generating.
    if (process.env.VOICE_DEBUG_AUDIO === '1') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const keys = Object.keys(msg).filter((k) => (msg as any)[k] != null)
      const sc = msg.serverContent
      const subkeys: string[] = []
      if (sc) {
        if (sc.modelTurn) subkeys.push('modelTurn')
        if (sc.inputTranscription) subkeys.push('inputTranscription')
        if (sc.outputTranscription) subkeys.push('outputTranscription')
        if (sc.turnComplete) subkeys.push('turnComplete')
        if (sc.interrupted) subkeys.push('interrupted')
      }
      this.logger.log(
        `[VOICE Live→NestJS] event keys=${keys.join(',')}` +
          (subkeys.length ? ` serverContent=${subkeys.join(',')}` : '') +
          ` [socket=${socketId}]`,
      )
    }

    if (msg.setupComplete) {
      // The onopen callback already fired callbacks.onReady(); setupComplete
      // is just the model handshake confirmation.
      this.logger.log(`[VOICE Live] setupComplete [socket=${socketId}]`)
      return
    }

    if (msg.serverContent) {
      const c = msg.serverContent
      // ── Audio chunks (PCM 24kHz from agent) ─────────────────────────────
      const parts = c.modelTurn?.parts ?? []
      for (const p of parts) {
        const inline = p.inlineData
        if (inline?.data && inline.mimeType?.startsWith('audio/')) {
          const rawData = Buffer.from(inline.data, 'base64')
          if (session.agentAudioBytes < MAX_AUDIO_BYTES) {
            session.agentAudioChunks.push(rawData)
            session.agentAudioBytes += rawData.length
          }
          if (session.lastUserFinalAt !== null) {
            const ms = Date.now() - session.lastUserFinalAt
            this.logger.log(`[VOICE latency] user_final→first_audio=${ms}ms [socket=${socketId}]`)
            session.lastUserFinalAt = null
          }
          if (process.env.VOICE_DEBUG_AUDIO === '1') {
            this.logger.log(`[VOICE Live→NestJS] audio bytes=${rawData.length} [socket=${socketId}]`)
          }
          callbacks.onAudio(inline.data)
        }
      }
      // ── Transcripts (input = user, output = agent) ──────────────────────
      const inT = c.inputTranscription?.text
      if (inT) {
        const trimmed = inT.trim()
        // Gemini Live emits incremental transcripts; treat each chunk as a
        // partial. The frontend already handles the (text, isFinal) shape.
        callbacks.onTranscript(inT, false, 'user')
        if (trimmed && session.transcriptBuffer.length < 200) {
          session.transcriptBuffer.push({ speaker: 'user', text: trimmed })
          session.activity.userTexts.push(trimmed)
        }
        // Stamp ONCE per turn — the first non-empty partial. Gemini emits
        // incremental inputTranscriptions and re-stamping on each one made
        // the user_final→first_audio log report only the gap from the LAST
        // partial, silently masking the true wait. The stamp clears back
        // to null when the agent's first audio chunk arrives (see modelTurn
        // branch above), so the next turn re-stamps freshly.
        if (trimmed && session.lastUserFinalAt === null) {
          session.lastUserFinalAt = Date.now()
        }
      }
      const outT = c.outputTranscription?.text
      if (outT) {
        const trimmed = outT.trim()
        callbacks.onTranscript(outT, false, 'agent')
        if (trimmed && session.transcriptBuffer.length < 200) {
          session.transcriptBuffer.push({ speaker: 'agent', text: trimmed })
          session.activity.agentTexts.push(trimmed)
        }
        // Bug 22 Fix 1 — accumulate the agent transcript for the
        // in-progress turn so the hallucination detector at turnComplete
        // can scan it. We append the RAW (untrimmed) chunk so word
        // boundaries are preserved across chunks.
        session.currentTurnAgentText += outT
      }
      // Generation-complete is the closest analogue to ADK's "speaker turn
      // ended" signal. Mark the last transcript line as final so the UI can
      // commit it. (turnComplete is unreliable on native-audio for *audio*
      // end-of-turn — see VoiceSessionCallbacks docstring — but it remains
      // a fine boundary for transcript finalisation here on the server.)
      if (c.turnComplete && session.transcriptBuffer.length > 0) {
        const last = session.transcriptBuffer[session.transcriptBuffer.length - 1]
        callbacks.onTranscript(last.text, true, last.speaker)
      }
      // Bug 22 Fix 1 — hallucination detector. Runs once per turnComplete
      // boundary. Compares the agent transcript accumulated since the
      // last turn end against the write-tools fired in the same turn.
      // Resets per-turn state so the next turn is scored fresh.
      if (c.turnComplete) {
        this.detectHallucination(session, socketId)
        session.currentTurnAgentText = ''
        session.currentTurnWriteToolsCalled.clear()
        session.hallucinationFlaggedThisTurn = false
      }
      // generationComplete is the canonical end-of-audio signal — forward to
      // the client so it can flip out of agent_speaking without relying on
      // the silence-based drain backstop.
      if (c.generationComplete) {
        callbacks.onGenerationComplete()
      }
      if (c.interrupted) {
        this.logger.log(`[VOICE Live] interrupted [socket=${socketId}]`)
        callbacks.onInterrupted()
      }
      return
    }

    if (msg.toolCall) {
      const calls = msg.toolCall.functionCalls ?? []
      const responses: FunctionResponse[] = []
      for (const fc of calls) {
        const name = fc.name ?? ''
        const args = (fc.args ?? {}) as Record<string, unknown>
        this.logger.log(`[VOICE Live] toolCall name=${name} id=${fc.id ?? '?'} [socket=${socketId}]`)
        // Bug 22 Fix 1 — record which write-tools fired this turn so the
        // hallucination detector at turnComplete can correlate them
        // against the agent's spoken claims.
        if (name) session.currentTurnWriteToolsCalled.add(name)
        const result = await tracer.startActiveSpan(
          `voice.tool.${name || 'unknown'}`,
          async (span) => {
            span.setAttribute('voice.tool.name', name)
            span.setAttribute('voice.user.id', session.userId)
            try {
              const r = await this.voiceTools.dispatch(name, args, {
                userId: session.userId,
                timezone: session.timezone,
              })
              span.setAttribute(
                'voice.tool.ok',
                Boolean(
                  (r.llmResponse as Record<string, unknown>).saved ??
                    (r.llmResponse as Record<string, unknown>).updated ??
                    !(r.llmResponse as Record<string, unknown>).error,
                ),
              )
              return r
            } catch (err) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: (err as Error).message,
              })
              throw err
            } finally {
              span.end()
            }
          },
        )
        // Fan out side-channel events (action notices, checkin summaries) to
        // the WebSocket client BEFORE sending the toolResponse so the UI
        // updates while the model is still composing its spoken reply.
        for (const ev of result.events) {
          this.relayToolEvent(session, ev)
        }
        responses.push({
          id: fc.id,
          name,
          response: result.llmResponse,
        })
      }
      try {
        session.liveSession.sendToolResponse({ functionResponses: responses })
      } catch (err) {
        this.logger.error(`[VOICE Live] sendToolResponse failed [socket=${socketId}]`, err)
      }
      return
    }

    if (msg.toolCallCancellation) {
      this.logger.log(`[VOICE Live] toolCallCancellation ids=${(msg.toolCallCancellation.ids ?? []).join(',')} [socket=${socketId}]`)
      return
    }

    if (msg.goAway) {
      this.logger.warn(`[VOICE Live] goAway timeLeft=${msg.goAway.timeLeft ?? '?'} [socket=${socketId}]`)
      return
    }

    if (msg.usageMetadata) {
      // Quiet trace — useful for cost telemetry but noisy at debug level.
      return
    }
  }

  /**
   * Bug 22 Fix 1 — hallucination detector.
   *
   * Worst-case bug class for a clinical chat: the model emits audio
   * saying "your reading is saved" or "I've deleted that for you"
   * without ever calling submit_checkin / update_checkin /
   * delete_checkin. Prompt-level guards ("Your words alone do not
   * change the database", "the tool call IS the response") are real
   * but soft — the model can ignore them, and Gemini Live's
   * audio + tool-call streams arrive as independent message types
   * with no atomic coupling.
   *
   * This detector closes the loop at the protocol level. Per turn:
   *   • currentTurnAgentText accumulates the model's transcript chunks
   *   • currentTurnWriteToolsCalled records which write-tools fired
   *   • on turnComplete we cross-check: if the transcript claims a
   *     write action (saved / updated / deleted) but the matching tool
   *     did NOT fire this turn, log an ERROR and fire
   *     onHallucinationSuspected so the frontend can surface a banner
   *     and re-verify via get_recent_readings.
   *
   * Regex notes:
   *   • save: includes "saved", "recorded", "logged it", and the
   *     phrasing the prompt teaches ("your reading is saved"). Anchored
   *     to avoid matching "save" in conditional / question contexts
   *     like "would you like me to save it?".
   *   • update / delete: past-tense indicative only; "updating" /
   *     "deleting" gerunds are allowed because they describe an action
   *     in progress (the tool call is mid-flight).
   *
   * False-positive tolerance: we accept that the model may sometimes
   * say "saved" in a non-confirmation context (e.g. "I saved your
   * preferences earlier"). The cost of a spurious banner is far less
   * than the cost of silently confirming a write that never happened
   * to a hypertensive patient.
   *
   * The check fires at most once per turn — hallucinationFlaggedThisTurn
   * prevents double-emit if multiple turnComplete signals arrive
   * (rare but possible during model self-interrupt).
   */
  private detectHallucination(session: ActiveSession, socketId: string): void {
    if (session.hallucinationFlaggedThisTurn) return
    const text = session.currentTurnAgentText
    if (!text || text.trim().length === 0) return

    // Past-tense write confirmations only. Avoid matching "save" / "saving"
    // / "would you like to save" — those are not claims that the write
    // happened.
    const saveClaim =
      /\b(?:saved|recorded|logged it)\b|your\s+(?:reading|check[- ]?in)\s+(?:is|has\s+been)\s+(?:saved|recorded|logged)/i
    const updateClaim =
      /\b(?:updated|changed it|edited|modified it)\b|your\s+(?:reading|check[- ]?in)\s+(?:is|has\s+been)\s+updated/i
    const deleteClaim =
      /\b(?:deleted|removed|erased)\b|your\s+(?:reading|check[- ]?in)\s+(?:is|has\s+been)\s+(?:deleted|removed)/i

    const firedSave =
      session.currentTurnWriteToolsCalled.has('submit_checkin') ||
      session.currentTurnWriteToolsCalled.has('finalize_checkin') ||
      session.currentTurnWriteToolsCalled.has('submit_bp_from_photo')
    const firedUpdate = session.currentTurnWriteToolsCalled.has('update_checkin')
    const firedDelete = session.currentTurnWriteToolsCalled.has('delete_checkin')

    let claim: 'save' | 'update' | 'delete' | null = null
    if (saveClaim.test(text) && !firedSave) claim = 'save'
    else if (updateClaim.test(text) && !firedUpdate) claim = 'update'
    else if (deleteClaim.test(text) && !firedDelete) claim = 'delete'

    if (!claim) return

    session.hallucinationFlaggedThisTurn = true
    const excerpt = text.slice(0, 240).replace(/\s+/g, ' ').trim()
    this.logger.error(
      `[VOICE hallucination_suspected] type=${claim} ` +
        `tools=[${[...session.currentTurnWriteToolsCalled].join(',')}] ` +
        `transcript="${excerpt}" [socket=${socketId}]`,
    )
    try {
      session.callbacks.onHallucinationSuspected?.(claim, excerpt)
    } catch (err) {
      this.logger.warn(`onHallucinationSuspected callback threw: ${err}`)
    }
  }

  private relayToolEvent(session: ActiveSession, ev: ToolEvent): void {
    const { callbacks, activity } = session
    switch (ev.kind) {
      case 'action':
        callbacks.onAction(ev.type, ev.detail)
        activity.actions.push({ type: ev.type, detail: ev.detail, timestamp: Date.now() })
        break
      case 'action_complete':
        callbacks.onActionComplete(ev.type, ev.success, ev.detail)
        break
      case 'checkin_saved':
        callbacks.onCheckinSaved(ev.payload)
        activity.checkins.push(ev.payload)
        break
      case 'checkin_updated':
        callbacks.onCheckinUpdated(ev.payload)
        break
      case 'checkin_deleted':
        callbacks.onCheckinDeleted(ev.payload)
        break
    }
  }

  sendAudio(socketId: string, audioBase64: string): void {
    const session = this.sessions.get(socketId)
    if (!session || session.streamClosed) return
    try {
      const data = Buffer.from(audioBase64, 'base64')
      // Buffer user audio for post-session transcription
      if (session.userAudioBytes < MAX_AUDIO_BYTES) {
        session.userAudioChunks.push(data)
        session.userAudioBytes += data.length
      }
      session.userAudioChunkCount += 1
      // Diagnostic: every 25th chunk under VOICE_DEBUG_AUDIO=1. ~25 chunks
      // at 32 ms/chunk = 800 ms of audio. Helps confirm audio is reaching
      // Gemini when troubleshooting "listening forever".
      if (
        process.env.VOICE_DEBUG_AUDIO === '1' &&
        session.userAudioChunkCount % 25 === 0
      ) {
        this.logger.log(
          `[VOICE NestJS→Live] forwarded ${session.userAudioChunkCount} chunks ` +
            `(${(session.userAudioBytes / 1024).toFixed(1)} KB) [socket=${socketId}]`,
        )
      }
      // Gemini Live wants Blob.data as a base64 string, NOT a Buffer.
      session.liveSession.sendRealtimeInput({
        audio: { data: audioBase64, mimeType: 'audio/pcm;rate=16000' },
      })
    } catch (err) {
      this.logger.error('Failed to forward audio to Gemini Live', err)
      session.streamClosed = true
      session.callbacks.onError('Voice connection lost. Please try again.')
      void this.endSession(socketId)
    }
  }

  sendText(socketId: string, text: string): void {
    const session = this.sessions.get(socketId)
    if (!session || session.streamClosed) return
    try {
      session.liveSession.sendRealtimeInput({ text })
      // Track user text input in activity
      if (text.trim()) {
        session.activity.userTexts.push(text.trim())
      }
    } catch (err) {
      this.logger.error('Failed to forward text to Gemini Live', err)
      session.streamClosed = true
      session.callbacks.onError('Voice connection lost. Please try again.')
      void this.endSession(socketId)
    }
  }

  /**
   * Forward client-side VAD "user paused" signal to Gemini Live. Gemini's
   * server-side VAD otherwise waits ~300-500ms of trailing silence before
   * finalising the user turn; this shortcuts that wait.
   */
  sendAudioStreamEnd(socketId: string): void {
    const session = this.sessions.get(socketId)
    if (!session || session.streamClosed) return
    // Don't ACK end-of-utterance before ANY audio has flowed — prevents the
    // race where the frontend VAD fires `audio_stream_end` during the mic
    // warm-up window (300 ms silence before user even speaks). Gemini would
    // see an empty turn and not respond, leaving the patient stuck on
    // "listening". Once the patient has spoken once in this session, the
    // guard releases.
    if (session.userAudioChunkCount === 0) {
      if (process.env.VOICE_DEBUG_AUDIO === '1') {
        this.logger.log(
          `[VOICE NestJS→Live] suppressed empty audio_stream_end (no audio yet) [socket=${socketId}]`,
        )
      }
      return
    }
    try {
      session.liveSession.sendRealtimeInput({ audioStreamEnd: true })
      if (process.env.VOICE_DEBUG_AUDIO === '1') {
        this.logger.log(
          `[VOICE NestJS→Live] forwarded audio_stream_end (frontend VAD fired) [socket=${socketId}]`,
        )
      }
    } catch (err) {
      // Non-fatal — worst case the turn just takes longer to finalise.
      this.logger.warn(`Failed to forward audio_stream_end to Gemini Live: ${(err as Error).message}`)
    }
  }

  getSessionId(socketId: string): string | undefined {
    return this.sessions.get(socketId)?.sessionId
  }

  /** CRUD events invalidate so the next session rebuilds fresh context. */
  invalidateContextCache(userId: string): void {
    if (this.contextCache.delete(userId)) {
      this.logger.log(`[VOICE cache] invalidated patient context for user=${userId}`)
    }
  }

  /**
   * Bug 58 — every JournalEntry mutation (create / update / delete-with-
   * surviving-anchor / finalize) drops the voice patient-context cache so
   * the NEXT voice session pulls fresh data. Fixes the gap where edits made
   * outside the voice dispatcher — via chat tools, the HTTP REST endpoint
   * (My Readings → Edit modal), or the rule engine itself — left a follow-up
   * voice session showing pre-edit values.
   *
   * Mirrors the proven INTAKE_EVENTS.UPDATED pattern below. The event is
   * emitted from daily_journal.service.ts:194 (create), 371 (update), 893
   * (finalize), and 947 (delete-cascade re-evaluation anchor). Each payload
   * carries `userId`; we use only that field.
   */
  @OnEvent(JOURNAL_EVENTS.ENTRY_CREATED)
  @OnEvent(JOURNAL_EVENTS.ENTRY_UPDATED)
  onJournalEntryMutated(payload: { userId: string }): void {
    this.invalidateContextCache(payload.userId)
  }

  /**
   * Listener — IntakeService emits `intake.updated` after profile / medication
   * mutation. Drops the voice context cache so a FOLLOW-UP voice session sees
   * the new INTAKE STATUS block + fresh resolved conditions / medications.
   *
   * Bug 1 fix — also broadcast a system-style text turn to any CURRENTLY-OPEN
   * voice session(s) for this user. Gemini Live delivers the systemInstruction
   * exactly once at connect; without this nudge a patient who completes intake
   * in another tab during an active voice call stays stuck with the stale
   * "INTAKE STATUS: INCOMPLETE" instruction and the bot keeps refusing
   * submit_checkin until they end and restart the session.
   */
  @OnEvent(INTAKE_EVENTS.UPDATED)
  onIntakeUpdated(payload: IntakeUpdatedPayload): void {
    this.invalidateContextCache(payload.userId)
    let broadcastCount = 0
    for (const session of this.sessions.values()) {
      if (session.userId !== payload.userId) continue
      if (session.streamClosed) continue
      try {
        session.liveSession.sendRealtimeInput({
          text:
            '[System update: the patient has now completed their clinical intake. ' +
            'You may proceed with check-ins normally. Call check_intake_status if you ' +
            'need to confirm before the first save.]',
        })
        broadcastCount += 1
      } catch (err) {
        this.logger.warn(
          `[VOICE intake-broadcast] failed for user=${payload.userId}: ${(err as Error).message}`,
        )
      }
    }
    if (broadcastCount > 0) {
      this.logger.log(
        `[VOICE intake-broadcast] notified ${broadcastCount} active session(s) for user=${payload.userId}`,
      )
    }
  }

  async endSession(socketId: string): Promise<void> {
    const session = this.sessions.get(socketId)
    if (!session) return

    if (!session.streamClosed) {
      session.streamClosed = true
      try {
        session.liveSession.close()
      } catch {
        // Stream may already be closed
      }
    }

    await this.saveVoiceTranscript(socketId)
    this.sessions.delete(socketId)
    this.logger.log(`Voice session ended [socket=${socketId}]`)
  }

  onModuleDestroy(): void {
    for (const [socketId] of this.sessions) {
      void this.endSession(socketId)
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private async resolveSession(chatSessionId: string | undefined, userId: string): Promise<string> {
    if (chatSessionId) {
      const existing = await this.prisma.session.findFirst({
        where: { id: chatSessionId, userId },
        select: { id: true },
      })
      if (existing) return existing.id
    }

    const newId = randomUUID()
    await this.prisma.session.create({
      data: { id: newId, title: 'Voice Session', userId },
    })
    this.logger.log(`Created new session for voice [sessionId=${newId}]`)
    return newId
  }

  private async saveVoiceTranscript(socketId: string): Promise<void> {
    const saveStart = Date.now()
    const session = this.sessions.get(socketId)
    if (!session) return
    if (session.savedTranscript) {
      this.logger.log(`[FLOW] Step 10 — already saved, skipping [socket=${socketId}]`)
      return
    }
    session.savedTranscript = true
    this.logger.log(`[FLOW] Step 10 START — saving transcript [socket=${socketId}]`)

    const { activity } = session

    // Snapshot audio buffers and activity, then clear
    const userAudio = session.userAudioChunks
    const agentAudio = session.agentAudioChunks
    session.userAudioChunks = []
    session.agentAudioChunks = []
    session.userAudioBytes = 0
    session.agentAudioBytes = 0

    const activitySnapshot = {
      checkins: [...activity.checkins],
      actions: [...activity.actions],
    }
    session.activity = { userTexts: [], agentTexts: [], checkins: [], actions: [] }

    this.logger.log(
      `saveVoiceTranscript [socket=${socketId}] userAudioChunks=${userAudio.length} agentAudioChunks=${agentAudio.length} ` +
      `checkins=${activitySnapshot.checkins.length} actions=${activitySnapshot.actions.length}`,
    )

    try {
      // ── Transcribe audio using Gemini Flash (post-session) ──────────────
      let userTranscript = ''
      let agentTranscript = ''

      if (userAudio.length > 0) {
        try {
          const userWav = this.pcmToWav(userAudio, 16000)
          const userBase64 = userWav.toString('base64')
          this.logger.log(`Transcribing user audio [${(userWav.length / 1024).toFixed(0)} KB]`)
          userTranscript = await this.geminiService.transcribeAudio(userBase64)
          this.logger.log(`User transcript [${userTranscript.length} chars]: ${userTranscript.slice(0, 100)}`)
        } catch (err) {
          this.logger.error('Failed to transcribe user audio', err)
        }
      }

      if (agentAudio.length > 0) {
        try {
          const agentWav = this.pcmToWav(agentAudio, 24000)
          const agentBase64 = agentWav.toString('base64')
          this.logger.log(`Transcribing agent audio [${(agentWav.length / 1024).toFixed(0)} KB]`)
          agentTranscript = await this.geminiService.transcribeAudio(agentBase64)
          this.logger.log(`Agent transcript [${agentTranscript.length} chars]: ${agentTranscript.slice(0, 100)}`)
        } catch (err) {
          this.logger.error('Failed to transcribe agent audio', err)
        }
      }

      // ── Build transcript lines ─────────────────────────────────────────
      const lines: Array<{ speaker: 'user' | 'agent'; text: string }> = []
      if (userTranscript.trim()) {
        lines.push({ speaker: 'user', text: userTranscript.trim() })
      }
      if (agentTranscript.trim()) {
        lines.push({ speaker: 'agent', text: agentTranscript.trim() })
      }

      if (lines.length === 0) {
        // No transcription — fall back to activity-based summary
        const summaryParts: string[] = []
        let title = 'Voice Chat'

        for (const action of activitySnapshot.actions) {
          if (action.type === 'fetching_readings') {
            summaryParts.push(`- Patient requested to view past BP readings`)
          } else if (action.type === 'submitting_checkin') {
            summaryParts.push(`- Patient submitted a new check-in: ${action.detail || 'values recorded'}`)
          } else if (action.type === 'updating_checkin') {
            summaryParts.push(`- Patient updated a reading: ${action.detail || 'values changed'}`)
            title = 'Voice: Updated reading'
          } else if (action.type === 'deleting_checkin') {
            summaryParts.push(`- Patient deleted a reading: ${action.detail || 'entry removed'}`)
            title = 'Voice: Deleted reading'
          }
        }
        for (const c of activitySnapshot.checkins) {
          const bp = c.systolicBP && c.diastolicBP ? `${c.systolicBP}/${c.diastolicBP}` : 'unknown'
          const meds = c.medicationTaken === true ? 'taken' : c.medicationTaken === false ? 'missed' : 'not reported'
          const symp = c.symptoms.length > 0 ? c.symptoms.join(', ') : 'none'
          summaryParts.push(`- Check-in saved: BP ${bp} mmHg, medications ${meds}, symptoms: ${symp}`)
          title = `BP Check-in ${bp}`
        }

        const summary = summaryParts.length > 0
          ? summaryParts.join('\n')
          : '- Voice conversation about cardiovascular health'

        await this.prisma.session.update({
          where: { id: session.sessionId },
          data: { summary, title },
        }).catch((err) => this.logger.error('Failed to save summary', err))

        this.logger.log(`Saved activity-based summary [session=${session.sessionId}]`)
        return
      }

      // ── Save transcripts + generate LLM summary ───────────────────────
      await this.conversationHistory.saveVoiceTranscriptLines(session.sessionId, lines)

      // Generate a meaningful session title
      let title = 'Voice Chat'
      if (activitySnapshot.checkins.length > 0) {
        const c = activitySnapshot.checkins[0]
        const bp = c.systolicBP && c.diastolicBP ? `${c.systolicBP}/${c.diastolicBP}` : null
        title = bp ? `BP Check-in ${bp}` : 'Voice Check-in'
      } else if (userTranscript.trim()) {
        const firstMsg = userTranscript.trim().slice(0, 40)
        title = `Voice: ${firstMsg}${userTranscript.length > 40 ? '…' : ''}`
      }

      await this.prisma.session.update({
        where: { id: session.sessionId },
        data: { title },
      }).catch(() => {})

      this.logger.log(`[FLOW] Step 10 DONE — saved transcript [session=${session.sessionId}, lines=${lines.length}, title=${title}] (${Date.now() - saveStart}ms)`)
      this.logger.log(`Saved voice transcript [session=${session.sessionId}, title=${title}]`)
    } catch (err) {
      this.logger.error('Failed to save voice transcript', err)
    }
  }

  private async buildPatientContext(userId: string, sessionId?: string): Promise<string> {
    try {
      // Phase/16 — voice now uses the same clinical-context renderer as the
      // text chat. ProfileResolverService + v2 DeviationAlert columns +
      // SystemPromptService.buildPatientContext() give voice the same
      // conditions / meds / threshold / active-alert block (including the
      // three-tier patientMessage bodies) that the text chatbot sees.
      const [user, entries, activeAlerts, sessionData, resolvedContext, intakeStatus, openAwaiting] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            name: true,
            dateOfBirth: true,
            preferredLanguage: true,
            timezone: true,
            communicationPreference: true,
            // Phase/16 Item 6 — drives enrollment-aware post-submit messaging.
            enrollmentStatus: true,
            enrolledAt: true,
          },
        }),
        this.prisma.journalEntry.findMany({
          where: { userId },
          orderBy: { measuredAt: 'desc' },
          // Cap at 30 most-recent readings — matches chat.service.ts so the
          // voice agent sees the same history. Covers the 7-day baseline
          // window with room to spare, keeps prompt size bounded.
          take: 30,
          select: PATIENT_JOURNAL_FIELDS_FOR_LLM_PROMPT,
        }),
        this.prisma.deviationAlert.findMany({
          where: { userId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: PATIENT_DEVIATION_ALERT_FIELDS_FOR_LLM_PROMPT,
        }),
        // Bug 17 — prior-conversation summary so voice knows what the
        // patient already said in text (and in earlier voice turns) in this
        // same session. The full summary (compressed bullets + ALL append
        // lines, both [Text]- and [Voice]-tagged) — unlike the text-chat
        // path which slices the last 12 because they're shipped raw in the
        // Gemini `contents` array, voice has no contents array; the system
        // instruction is the only seed. Userid-scope guard inside the
        // helper (defence-in-depth against any future call site that
        // passes an unvalidated sessionId).
        sessionId
          ? this.conversationHistory.getSessionSummaryForVoice(userId, sessionId)
          : Promise.resolve(''),
        this.profileResolver.resolve(userId).catch((err: unknown) => {
          if (err instanceof ProfileNotFoundException) return null
          throw err
        }) as Promise<ResolvedContext | null>,
        // Cheap PK-scoped findUnique; renders the INTAKE STATUS block in the
        // patient-context. Mirrors chat.service.ts.
        this.intakeStatusService.getStatus(userId),
        // Phase/16 Item 2 — open AWAITING entry for Option D resume. Mirrors
        // chat.service.ts so voice and text behave identically when the
        // patient walked away from a held emergency-range reading.
        this.prisma.journalEntry.findFirst({
          where: {
            userId,
            emergencyConfirmation: 'AWAITING',
            singleReadingFinalized: false,
            sessionClosedAt: null,
          },
          orderBy: { measuredAt: 'desc' },
          select: { id: true, measuredAt: true, systolicBP: true, diastolicBP: true },
        }),
      ])

      // Trailing 7-day mean — shared helper in @cardioplace/shared/derivatives
      // ensures chat + voice render identical baselines.
      const baseline = getTrailing7DayBaseline(entries)

      // Delegate rendering to the chat SystemPromptService so the voice agent
      // and text chatbot see an identical clinical-context block.
      const patientContext = this.systemPromptService.buildPatientContext({
        recentEntries: entries.map((e) => ({
          measuredAt: e.measuredAt,
          systolicBP: e.systolicBP != null ? Number(e.systolicBP) : null,
          diastolicBP: e.diastolicBP != null ? Number(e.diastolicBP) : null,
          weight: e.weight != null ? Number(e.weight) : null,
          medicationTaken: e.medicationTaken,
          otherSymptoms: e.otherSymptoms,
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
        enrollmentStatus: user?.enrollmentStatus ?? null,
        openAwaiting: openAwaiting
          ? {
              id: openAwaiting.id,
              systolicBP: openAwaiting.systolicBP != null ? Number(openAwaiting.systolicBP) : null,
              diastolicBP: openAwaiting.diastolicBP != null ? Number(openAwaiting.diastolicBP) : null,
              measuredAt: openAwaiting.measuredAt,
            }
          : null,
        toneMode: 'PATIENT',
        // Voice-only: never inline per-reading BP numbers. Native-audio LLMs
        // echo prompt-injected numbers as if the patient just said them. The
        // LLM uses get_recent_readings to fetch historical values on demand.
        omitReadingValues: true,
      })

      // Current date/time in patient timezone — voice-specific, kept here
      // because the system instruction references "CURRENT DATE AND TIME".
      const tz = user?.timezone ?? 'America/New_York'
      this.logger.log(
        `[TIMEZONE] user=${userId} stored=${user?.timezone ?? 'null'} using=${tz} now=${new Date().toISOString()}`,
      )
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

      // Bug 17 — when joining a session that already has prior turns (text
      // or voice or both), seed Gemini Live with the rolling summary so the
      // bot doesn't greet fresh and re-ask questions already answered. The
      // summary already labels each turn `[Text]` / `[Voice]`. Empty string
      // → fresh session, no block injected, no fresh-greet weirdness.
      const priorConversationBlock =
        typeof sessionData === 'string' && sessionData.trim().length > 0
          ? `\n\n--- PRIOR CONVERSATION SUMMARY (text + voice turns so far) ---\n${sessionData}\n--- END PRIOR CONVERSATION ---\n\nYou are JOINING an ongoing conversation. The block above is what the patient and the chatbot already discussed in this session — across text AND voice turns. Use it to maintain continuity: do NOT greet the patient as if it's a fresh conversation, do NOT re-ask questions already answered, and acknowledge anything the patient already told you.`
          : ''

      return `${patientContext}${priorConversationBlock}\n\nCURRENT DATE AND TIME (patient timezone ${tz}): ${currentDate} at ${currentTime}. When the patient says "now", "today", or "right now", use EXACTLY this date and time. NEVER guess a different date or time.`
    } catch {
      return 'Patient context unavailable.'
    }
  }
}
