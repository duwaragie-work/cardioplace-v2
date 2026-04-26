import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  getTrailing7DayBaseline,
  ProfileNotFoundException,
  type ResolvedContext,
} from '@cardioplace/shared'
import { PrismaService } from '../prisma/prisma.service.js'
import { ConversationHistoryService } from '../chat/services/conversation-history.service.js'
import { SystemPromptService } from '../chat/services/system-prompt.service.js'
import { ProfileResolverService } from '../daily_journal/services/profile-resolver.service.js'
import { GeminiService } from '../gemini/gemini.service.js'

export interface VoiceSessionCallbacks {
  onReady: () => void
  onAudio: (audioBase64: string) => void
  onTranscript: (text: string, isFinal: boolean, speaker: 'user' | 'agent') => void
  onAction: (type: string, detail: string) => void
  onActionComplete: (type: string, success: boolean, detail: string) => void
  onCheckinSaved: (summary: CheckinSummary) => void
  onCheckinUpdated: (summary: UpdateSummary) => void
  onCheckinDeleted: (summary: DeleteSummary) => void
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

interface ActiveSession {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: any
  userId: string
  sessionId: string
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private voiceClient: any

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly conversationHistory: ConversationHistoryService,
    private readonly geminiService: GeminiService,
    private readonly systemPromptService: SystemPromptService,
    private readonly profileResolver: ProfileResolverService,
  ) {
    this.initGrpcClient()
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

  private initGrpcClient(): void {
    // Resolve relative to this file, not process.cwd(). Hardens against
    // tooling (jest, tsx, nest-cli) launched from a different directory —
    // and works identically for `src/` (dev) and `dist/` (prod) because
    // the compiled layout preserves the `../../proto/voice.proto` depth.
    const protoPath = fileURLToPath(
      new URL('../../proto/voice.proto', import.meta.url),
    )

    const packageDef = protoLoader.loadSync(protoPath, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const protoDesc = grpc.loadPackageDefinition(packageDef) as any

    const host = this.config.get<string>('ADK_SERVICE_HOST', 'localhost')
    const port = this.config.get<string>('ADK_SERVICE_PORT', '50051')

    this.voiceClient = new protoDesc.voice.VoiceAgent(
      `${host}:${port}`,
      grpc.credentials.createInsecure(),
      {
        'grpc.max_receive_message_length': 10 * 1024 * 1024,
        'grpc.max_send_message_length': 10 * 1024 * 1024,
      },
    )

    this.logger.log(`gRPC client configured → ${host}:${port}`)
  }

  async createSession(
    socketId: string,
    userId: string,
    callbacks: VoiceSessionCallbacks,
    authToken = '',
    chatSessionId?: string,
  ): Promise<void> {
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

    // Open bidirectional gRPC stream (Step 4)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let call: any
    try {
      call = this.voiceClient.StreamSession()
      this.logger.log(`[FLOW] Step 4 — gRPC stream opened to ADK (${Date.now() - t0}ms)`)
    } catch (err) {
      this.logger.error(`[FLOW] Step 4 FAIL — gRPC stream failed (${Date.now() - t0}ms)`, err)
      callbacks.onError('Could not connect to voice service. Please try again.')
      return
    }

    const activeSession: ActiveSession = {
      call, userId, sessionId, transcriptBuffer: [],
      activity: { userTexts: [], agentTexts: [], checkins: [], actions: [] },
      savedTranscript: false,
      streamClosed: false,
      closedNotified: false,
      userAudioChunks: [],
      agentAudioChunks: [],
      userAudioBytes: 0,
      agentAudioBytes: 0,
      lastUserFinalAt: null,
      callbacks,
    }
    this.sessions.set(socketId, activeSession)

    // ── Handle messages from ADK service ──────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call.on('data', (msg: any) => {
      const payload: string = msg.payload

      if (payload === 'ready') {
        this.logger.log(`[VOICE gRPC→NestJS] ready [socket=${socketId}]`)
        callbacks.onReady()
      } else if (payload === 'audio') {
        const rawData = Buffer.isBuffer(msg.audio.data)
          ? msg.audio.data
          : Buffer.from(msg.audio.data)
        // Buffer agent audio for post-session transcription
        if (activeSession.agentAudioBytes < MAX_AUDIO_BYTES) {
          activeSession.agentAudioChunks.push(rawData)
          activeSession.agentAudioBytes += rawData.length
        }
        // Latency: first agent audio chunk after a user final — log and clear.
        if (activeSession.lastUserFinalAt !== null) {
          const ms = Date.now() - activeSession.lastUserFinalAt
          this.logger.log(`[VOICE latency] user_final→first_audio=${ms}ms [socket=${socketId}]`)
          activeSession.lastUserFinalAt = null
        }
        const audioBase64 = rawData.toString('base64')
        // Audio arrives at ~50Hz — only log when VOICE_DEBUG_AUDIO=1
        if (process.env.VOICE_DEBUG_AUDIO === '1') {
          this.logger.log(`[VOICE gRPC→NestJS] audio bytes=${rawData.length} [socket=${socketId}]`)
        }
        callbacks.onAudio(audioBase64)
      } else if (payload === 'transcript') {
        const t = msg.transcript
        const text: string = t.text ?? ''
        const isFinal: boolean = t.isFinal ?? false
        const speaker = (t.speaker as 'user' | 'agent') ?? 'agent'
        this.logger.log(`[VOICE gRPC→NestJS] transcript speaker=${speaker} isFinal=${isFinal} len=${text.length} [socket=${socketId}]`)
        // Latency: stamp user's final transcript so the next audio chunk can
        // measure round-trip time at the NestJS layer.
        if (speaker === 'user' && isFinal && text.trim()) {
          activeSession.lastUserFinalAt = Date.now()
        }
        callbacks.onTranscript(text, isFinal, speaker)
        // Accumulate non-empty transcript lines for persistence (cap at 200 to
        // avoid RESOURCE_EXHAUSTED when sessions run long).
        if (text.trim()) {
          const sess = this.sessions.get(socketId)
          if (sess && sess.transcriptBuffer.length < 200) {
            sess.transcriptBuffer.push({ speaker, text: text.trim() })
            // Also track in activity for fallback summary
            if (speaker === 'user') {
              sess.activity.userTexts.push(text.trim())
            } else {
              sess.activity.agentTexts.push(text.trim())
            }
          }
        }
      } else if (payload === 'action') {
        const actionType = msg.action.type ?? ''
        const actionDetail = msg.action.detail ?? ''
        this.logger.log(`[VOICE gRPC→NestJS] action type=${actionType} detail=${actionDetail.slice(0, 80)} [socket=${socketId}]`)
        callbacks.onAction(actionType, actionDetail)
        // Track action for summary
        const sess = this.sessions.get(socketId)
        if (sess) {
          sess.activity.actions.push({ type: actionType, detail: actionDetail, timestamp: Date.now() })
          this.logger.log(`[ACTION TRACKED] total actions=${sess.activity.actions.length}`)
        }
      } else if (payload === 'actionComplete') {
        const ac = msg.actionComplete
        const type = ac?.type ?? ''
        const success = ac?.success ?? false
        const detail = ac?.detail ?? ''
        this.logger.log(`[VOICE gRPC→NestJS] action_complete type=${type} success=${success} [socket=${socketId}]`)
        callbacks.onActionComplete(type, success, detail)
      } else if (payload === 'checkin') {
        const c = msg.checkin
        this.logger.log(`[VOICE gRPC→NestJS] checkin BP=${c.systolicBp}/${c.diastolicBp} saved=${c.saved} [socket=${socketId}]`)
        callbacks.onCheckinSaved({
          systolicBP: c.systolicBp ?? undefined,
          diastolicBP: c.diastolicBp ?? undefined,
          weight: c.weight > 0 ? c.weight : undefined,
          medicationTaken: c.medicationTaken,
          symptoms: c.symptoms ?? [],
          saved: c.saved ?? false,
        })
        // Track the checkin in activity
        const sessC = this.sessions.get(socketId)
        if (sessC) {
          sessC.activity.checkins.push({
            systolicBP: c.systolicBp ?? undefined,
            diastolicBP: c.diastolicBp ?? undefined,
            weight: c.weight > 0 ? c.weight : undefined,
            medicationTaken: c.medicationTaken,
            symptoms: c.symptoms ?? [],
            saved: c.saved ?? false,
          })
        }
      } else if (payload === 'updated') {
        const u = msg.updated
        this.logger.log(`[VOICE gRPC→NestJS] updated entryId=${u.entryId} updated=${u.updated} [socket=${socketId}]`)
        callbacks.onCheckinUpdated({
          entryId: u.entryId ?? '',
          entryDate: u.entryDate ?? undefined,
          systolicBP: u.systolicBp ?? undefined,
          diastolicBP: u.diastolicBp ?? undefined,
          weight: u.weight > 0 ? u.weight : undefined,
          medicationTaken: u.medicationTaken,
          symptoms: u.symptoms ?? [],
          updated: u.updated ?? false,
        })
      } else if (payload === 'deleted') {
        const d = msg.deleted
        this.logger.log(`[VOICE gRPC→NestJS] deleted count=${d.deletedCount}/${d.failedCount} success=${d.success} [socket=${socketId}]`)
        callbacks.onCheckinDeleted({
          entryIds: d.entryIds ?? [],
          deletedCount: d.deletedCount ?? 0,
          failedCount: d.failedCount ?? 0,
          success: d.success ?? false,
          message: d.message ?? '',
        })
      } else if (payload === 'error') {
        this.logger.warn(`[VOICE gRPC→NestJS] error msg="${msg.error.message}" [socket=${socketId}]`)
        callbacks.onError(msg.error.message ?? 'Unknown voice service error')
      } else if (payload === 'closed') {
        this.logger.log(`[VOICE gRPC→NestJS] closed [socket=${socketId}]`)
        activeSession.streamClosed = true
        this.saveVoiceTranscript(socketId)
          .then(() => {
            this.sessions.delete(socketId)
            if (!activeSession.closedNotified) {
              activeSession.closedNotified = true
              callbacks.onClose()
            }
          })
      } else {
        this.logger.warn(`[VOICE gRPC→NestJS] UNKNOWN payload="${payload}" [socket=${socketId}]`)
      }
    })

    call.on('error', (err: Error) => {
      this.logger.error(`[VOICE gRPC→NestJS] STREAM ERROR name=${err.name} msg=${err.message} [socket=${socketId}]`, err.stack)
      activeSession.streamClosed = true
      this.saveVoiceTranscript(socketId)
        .then(() => {
          this.sessions.delete(socketId)
          callbacks.onError('Voice service connection lost. Please try again.')
        })
    })

    call.on('end', () => {
      this.logger.log(`[VOICE gRPC→NestJS] STREAM END alreadyClosed=${activeSession.streamClosed} notified=${activeSession.closedNotified} [socket=${socketId}]`)
      activeSession.streamClosed = true
      this.saveVoiceTranscript(socketId)
        .then(() => {
          this.sessions.delete(socketId)
          if (!activeSession.closedNotified) {
            activeSession.closedNotified = true
            callbacks.onClose()
          }
        })
    })

    // ── Send SessionInit as first message ─────────────────────────────────────
    call.write({
      init: {
        userId,
        mode: 'chat',
        patientContext,
        authToken,
      },
    })

    this.logger.log(`Voice session started [socket=${socketId}, user=${userId}, chatSession=${sessionId}]`)
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
      session.call.write({
        audio: { data, mimeType: 'audio/pcm;rate=16000' },
      })
    } catch (err) {
      this.logger.error('Failed to forward audio to ADK service', err)
      session.streamClosed = true
      session.callbacks.onError('Voice connection lost. Please try again.')
      void this.endSession(socketId)
    }
  }

  sendText(socketId: string, text: string): void {
    const session = this.sessions.get(socketId)
    if (!session || session.streamClosed) return
    try {
      session.call.write({ text: { text } })
      // Track user text input in activity
      if (text.trim()) {
        session.activity.userTexts.push(text.trim())
      }
    } catch (err) {
      this.logger.error('Failed to forward text to ADK service', err)
      session.streamClosed = true
      session.callbacks.onError('Voice connection lost. Please try again.')
      void this.endSession(socketId)
    }
  }

  /**
   * Forward client-side VAD "user paused" signal to ADK. Gemini Live's
   * server-side VAD otherwise waits ~300-500ms of trailing silence before
   * finalising the user turn; this shortcuts that wait.
   */
  sendAudioStreamEnd(socketId: string): void {
    const session = this.sessions.get(socketId)
    if (!session || session.streamClosed) return
    try {
      session.call.write({ endOfUtterance: {} })
    } catch (err) {
      // Non-fatal — worst case the turn just takes longer to finalise.
      this.logger.warn(`Failed to forward audio_stream_end to ADK: ${(err as Error).message}`)
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

  async endSession(socketId: string): Promise<void> {
    const session = this.sessions.get(socketId)
    if (!session) return

    if (!session.streamClosed) {
      session.streamClosed = true
      try {
        session.call.write({ end: {} })
        session.call.end()
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
      //
      // The guardrails themselves live in adk-service/agent/prompts.py since
      // they're the voice agent's static directives; this method only builds
      // the per-session patient context payload.
      const [user, entries, activeAlerts, sessionData, resolvedContext] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            name: true,
            dateOfBirth: true,
            preferredLanguage: true,
            timezone: true,
            communicationPreference: true,
          },
        }),
        this.prisma.journalEntry.findMany({
          where: { userId },
          orderBy: { measuredAt: 'desc' },
          // Cap at 30 most-recent readings — matches chat.service.ts so the
          // voice agent sees the same history. Covers the 7-day baseline
          // window with room to spare, keeps prompt size bounded.
          take: 30,
          select: {
            measuredAt: true,
            systolicBP: true,
            diastolicBP: true,
            weight: true,
            medicationTaken: true,
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
        sessionId
          ? this.prisma.session.findUnique({
              where: { id: sessionId },
              select: { summary: true },
            })
          : Promise.resolve(null),
        this.profileResolver.resolve(userId).catch((err: unknown) => {
          if (err instanceof ProfileNotFoundException) return null
          throw err
        }) as Promise<ResolvedContext | null>,
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
        toneMode: 'PATIENT',
      })

      // Current date/time in patient timezone — voice-specific, kept here
      // because the Python prompt references "CURRENT DATE AND TIME".
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

      // historySummary intentionally NOT injected — Gemini Live accumulates
      // conversation context turn-by-turn, duplicating adds no value.
      void sessionData

      return `${patientContext}\n\nCURRENT DATE AND TIME (patient timezone ${tz}): ${currentDate} at ${currentTime}. When the patient says "now", "today", or "right now", use EXACTLY this date and time. NEVER guess a different date or time.`
    } catch {
      return 'Patient context unavailable.'
    }
  }
}
