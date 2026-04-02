import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { PrismaService } from '../prisma/prisma.service.js'
import { MistralService } from '../mistral/mistral.service.js'
import { ConversationHistoryService } from '../chat/services/conversation-history.service.js'

export interface VoiceSessionCallbacks {
  onReady: () => void
  onAudio: (audioBase64: string) => void
  onTranscript: (text: string, isFinal: boolean, speaker: 'user' | 'agent') => void
  onAction: (type: string, detail: string) => void
  onCheckinSaved: (summary: CheckinSummary) => void
  onCheckinUpdated: (summary: UpdateSummary) => void
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

interface TranscriptEntry {
  speaker: 'user' | 'agent'
  text: string
}

interface SessionActivity {
  userTexts: string[]
  agentTexts: string[]
  checkins: CheckinSummary[]
}

const TRANSCRIPTION_INTERVAL_MS = 2_000 // Transcribe every 2 seconds

interface ActiveSession {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: any
  userId: string
  sessionId: string
  transcriptBuffer: TranscriptEntry[]
  activity: SessionActivity
  userAudioBuffer: Buffer[]
  agentAudioBuffer: Buffer[]
  transcriptionTimer: ReturnType<typeof setInterval> | null
  callbacks: VoiceSessionCallbacks
  isAgentSpeaking: boolean
  isTranscribing: boolean
}

@Injectable()
export class VoiceService implements OnModuleDestroy {
  private readonly logger = new Logger(VoiceService.name)
  private readonly sessions = new Map<string, ActiveSession>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private voiceClient: any

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mistral: MistralService,
    private readonly conversationHistory: ConversationHistoryService,
  ) {
    this.initGrpcClient()
  }

  private initGrpcClient(): void {
    const protoPath = path.resolve(process.cwd(), 'proto', 'voice.proto')

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
    // Clean up any existing session for this socket
    await this.endSession(socketId)

    // Resolve or create a chat session for this voice interaction
    const sessionId = await this.resolveSession(chatSessionId, userId)

    const patientContext = await this.buildPatientContext(userId, sessionId)

    // Open bidirectional gRPC stream
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let call: any
    try {
      call = this.voiceClient.StreamSession()
    } catch (err) {
      this.logger.error('Failed to open gRPC stream to ADK service', err)
      callbacks.onError('Could not connect to voice service. Please try again.')
      return
    }

    const activeSession: ActiveSession = {
      call, userId, sessionId, transcriptBuffer: [],
      activity: { userTexts: [], agentTexts: [], checkins: [] },
      userAudioBuffer: [],
      agentAudioBuffer: [],
      transcriptionTimer: null,
      callbacks,
      isAgentSpeaking: false,
      isTranscribing: false,
    }
    this.sessions.set(socketId, activeSession)

    // Start periodic transcription of both user and agent audio
    activeSession.transcriptionTimer = setInterval(() => {
      this.transcribeBufferedAudio(socketId).catch((err) =>
        this.logger.error('Periodic transcription error', err),
      )
    }, TRANSCRIPTION_INTERVAL_MS)

    // ── Handle messages from ADK service ──────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call.on('data', (msg: any) => {
      const payload: string = msg.payload

      if (payload === 'ready') {
        callbacks.onReady()
      } else if (payload === 'audio') {
        const rawData = Buffer.isBuffer(msg.audio.data)
          ? msg.audio.data
          : Buffer.from(msg.audio.data)
        const audioBase64 = rawData.toString('base64')
        callbacks.onAudio(audioBase64)
        // Buffer agent audio for transcription
        const sessA = this.sessions.get(socketId)
        if (sessA) {
          sessA.agentAudioBuffer.push(rawData)
          sessA.isAgentSpeaking = true
        }
      } else if (payload === 'transcript') {
        const t = msg.transcript
        const text: string = t.text ?? ''
        const isFinal: boolean = t.isFinal ?? false
        const speaker = (t.speaker as 'user' | 'agent') ?? 'agent'
        callbacks.onTranscript(text, isFinal, speaker)
        // Accumulate all non-empty transcript lines for persistence.
        if (text.trim()) {
          const sess = this.sessions.get(socketId)
          if (sess) {
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
        callbacks.onAction(msg.action.type ?? '', msg.action.detail ?? '')
      } else if (payload === 'checkin') {
        const c = msg.checkin
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
      } else if (payload === 'error') {
        this.logger.warn(`ADK error [socket=${socketId}]: ${msg.error.message}`)
        callbacks.onError(msg.error.message ?? 'Unknown voice service error')
      } else if (payload === 'closed') {
        this.cleanupTimer(socketId)
        this.transcribeBufferedAudio(socketId)
          .then(() => this.saveVoiceTranscript(socketId))
          .then(() => {
            this.sessions.delete(socketId)
            callbacks.onClose()
          })
      }
    })

    call.on('error', (err: Error) => {
      this.logger.error(`gRPC stream error [socket=${socketId}]`, err.message)
      this.cleanupTimer(socketId)
      this.transcribeBufferedAudio(socketId)
        .then(() => this.saveVoiceTranscript(socketId))
        .then(() => {
          this.sessions.delete(socketId)
          callbacks.onError('Voice service connection lost. Please try again.')
        })
    })

    call.on('end', () => {
      this.logger.log(`gRPC stream ended [socket=${socketId}]`)
      this.cleanupTimer(socketId)
      this.transcribeBufferedAudio(socketId)
        .then(() => this.saveVoiceTranscript(socketId))
        .then(() => {
          this.sessions.delete(socketId)
          callbacks.onClose()
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
    if (!session) return
    try {
      const data = Buffer.from(audioBase64, 'base64')
      session.call.write({
        audio: { data, mimeType: 'audio/pcm;rate=16000' },
      })
      // Buffer user audio for Voxtral transcription
      session.userAudioBuffer.push(data)
      session.isAgentSpeaking = false
    } catch (err) {
      this.logger.error('Failed to forward audio to ADK service', err)
    }
  }

  sendText(socketId: string, text: string): void {
    const session = this.sessions.get(socketId)
    if (!session) return
    try {
      session.call.write({ text: { text } })
      // Track user text input in activity
      if (text.trim()) {
        session.activity.userTexts.push(text.trim())
      }
    } catch (err) {
      this.logger.error('Failed to forward text to ADK service', err)
    }
  }

  getSessionId(socketId: string): string | undefined {
    return this.sessions.get(socketId)?.sessionId
  }

  async endSession(socketId: string): Promise<void> {
    const session = this.sessions.get(socketId)
    if (!session) return

    // Stop the periodic transcription timer
    if (session.transcriptionTimer) {
      clearInterval(session.transcriptionTimer)
      session.transcriptionTimer = null
    }

    try {
      session.call.write({ end: {} })
      session.call.end()
    } catch {
      // Stream may already be closed
    }

    // Final transcription of any remaining audio (force through)
    session.isTranscribing = false
    await this.transcribeBufferedAudio(socketId)
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

  /**
   * Resolve to an existing session or create a new one for the user.
   */
  private async resolveSession(chatSessionId: string | undefined, userId: string): Promise<string> {
    if (chatSessionId) {
      // Verify the session belongs to this user
      const existing = await this.prisma.session.findFirst({
        where: { id: chatSessionId, userId },
        select: { id: true },
      })
      if (existing) return existing.id
    }

    // Create a new session for this voice interaction
    const newId = randomUUID()
    await this.prisma.session.create({
      data: { id: newId, title: 'Voice Session', userId },
    })
    this.logger.log(`Created new session for voice [sessionId=${newId}]`)
    return newId
  }

  /**
   * Summarise the accumulated voice transcript via Mistral into patient-side
   * and AI-side summaries, then delegate to ConversationHistoryService which
   * generates an embedding and saves to the Conversation table.
   */
  private cleanupTimer(socketId: string): void {
    const session = this.sessions.get(socketId)
    if (session?.transcriptionTimer) {
      clearInterval(session.transcriptionTimer)
      session.transcriptionTimer = null
    }
  }

  /**
   * Take buffered audio chunks for both user and agent, send to Voxtral
   * for transcription, emit transcripts to the frontend, and push to buffers.
   */
  private async transcribeBufferedAudio(socketId: string): Promise<void> {
    const session = this.sessions.get(socketId)
    if (!session) return

    // Skip if a previous transcription is still running
    if (session.isTranscribing) return
    session.isTranscribing = true

    const hasUser = session.userAudioBuffer.length > 0
    const hasAgent = session.agentAudioBuffer.length > 0
    if (!hasUser && !hasAgent) {
      session.isTranscribing = false
      return
    }

    // Snapshot and clear buffers
    const userChunks = hasUser ? [...session.userAudioBuffer] : []
    const agentChunks = hasAgent ? [...session.agentAudioBuffer] : []
    session.userAudioBuffer = []
    session.agentAudioBuffer = []

    // Minimum audio length: ~0.8s worth of audio to avoid sending tiny fragments
    // User: 16kHz 16-bit = 32000 bytes/sec → 0.8s = 25600 bytes
    // Agent: 24kHz 16-bit = 48000 bytes/sec → 0.8s = 38400 bytes
    const MIN_USER = 25600
    const MIN_AGENT = 38400

    const jobs: Promise<void>[] = []

    if (hasUser) {
      const combined = Buffer.concat(userChunks)
      if (combined.length >= MIN_USER) {
        jobs.push(
          this.mistral.transcribeAudio(combined).then((text) => {
            if (text.trim()) {
              this.logger.log(`Voxtral user transcript [${socketId}]: ${text.slice(0, 80)}`)
              session.transcriptBuffer.push({ speaker: 'user', text: text.trim() })
              session.activity.userTexts.push(text.trim())
              session.callbacks.onTranscript(text.trim(), true, 'user')
            }
          }).catch((err) => this.logger.error('User transcription failed', err)),
        )
      } else {
        // Put back if too short — will be picked up next cycle
        session.userAudioBuffer.push(combined)
      }
    }

    if (hasAgent) {
      const combined = Buffer.concat(agentChunks)
      if (combined.length >= MIN_AGENT) {
        jobs.push(
          this.mistral.transcribeAudio(combined).then((text) => {
            if (text.trim()) {
              this.logger.log(`Voxtral agent transcript [${socketId}]: ${text.slice(0, 80)}`)
              session.transcriptBuffer.push({ speaker: 'agent', text: text.trim() })
              session.activity.agentTexts.push(text.trim())
              session.callbacks.onTranscript(text.trim(), true, 'agent')
            }
          }).catch((err) => this.logger.error('Agent transcription failed', err)),
        )
      } else {
        session.agentAudioBuffer.push(combined)
      }
    }

    await Promise.all(jobs)
    session.isTranscribing = false
  }

  private async saveVoiceTranscript(socketId: string): Promise<void> {
    const session = this.sessions.get(socketId)
    if (!session) return

    const { transcriptBuffer, activity } = session

    this.logger.log(
      `saveVoiceTranscript [socket=${socketId}] transcripts=${transcriptBuffer.length} ` +
      `userTexts=${activity.userTexts.length} agentTexts=${activity.agentTexts.length} checkins=${activity.checkins.length}`,
    )

    // Take snapshots and clear
    const buffer = [...transcriptBuffer]
    session.transcriptBuffer = []
    const activitySnapshot = {
      userTexts: [...activity.userTexts],
      agentTexts: [...activity.agentTexts],
      checkins: [...activity.checkins],
    }
    session.activity = { userTexts: [], agentTexts: [], checkins: [] }

    try {
      // Build the lines to save — prefer transcript buffer, fall back to activity
      let lines: Array<{ speaker: 'user' | 'agent'; text: string }> = []

      if (buffer.length > 0) {
        lines = buffer
      } else {
        // Build lines from activity data
        for (const t of activitySnapshot.userTexts) {
          lines.push({ speaker: 'user', text: t })
        }
        for (const c of activitySnapshot.checkins) {
          const bp = c.systolicBP && c.diastolicBP ? `${c.systolicBP}/${c.diastolicBP} mmHg` : 'unknown'
          const meds = c.medicationTaken === true ? 'taken' : c.medicationTaken === false ? 'missed' : 'not reported'
          const symp = c.symptoms.length > 0 ? c.symptoms.join(', ') : 'no symptoms'
          lines.push({ speaker: 'user', text: `BP ${bp}, medications ${meds}, ${symp}` })
          lines.push({
            speaker: 'agent',
            text: c.saved
              ? `Saved check-in: BP ${bp}, medications ${meds}, ${symp}`
              : 'Attempted to save check-in but failed',
          })
        }
        for (const t of activitySnapshot.agentTexts) {
          lines.push({ speaker: 'agent', text: t })
        }
      }

      if (lines.length === 0) {
        this.logger.log(`No data to save for voice session [socket=${socketId}]`)
        return
      }

      // Save individual transcript lines as separate Conversation rows + update rolling summary
      await this.conversationHistory.saveVoiceTranscriptLines(session.sessionId, lines)

      // Generate a meaningful session title based on what happened
      let title = 'Voice Chat'
      if (activitySnapshot.checkins.length > 0) {
        const c = activitySnapshot.checkins[0]
        const bp = c.systolicBP && c.diastolicBP ? `${c.systolicBP}/${c.diastolicBP}` : null
        title = bp ? `BP Check-in ${bp}` : 'Voice Check-in'
      } else if (activitySnapshot.userTexts.length > 0) {
        // Use first user message as title hint (truncated)
        const firstMsg = activitySnapshot.userTexts[0].slice(0, 40)
        title = `Voice: ${firstMsg}${activitySnapshot.userTexts[0].length > 40 ? '…' : ''}`
      }

      await this.prisma.session.update({
        where: { id: session.sessionId },
        data: { title },
      }).catch(() => {}) // best-effort

      this.logger.log(`Saved voice transcript [session=${session.sessionId}, lines=${lines.length}, title=${title}]`)
    } catch (err) {
      this.logger.error('Failed to save voice transcript', err)
    }
  }

  private async buildPatientContext(userId: string, sessionId?: string): Promise<string> {
    try {
      const [user, entries, baseline, alerts, sessionData] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            name: true,
            primaryCondition: true,
            riskTier: true,
            dateOfBirth: true,
            preferredLanguage: true,
          },
        }),
        this.prisma.journalEntry.findMany({
          where: { userId },
          orderBy: { entryDate: 'desc' },
          take: 7,
        }),
        this.prisma.baselineSnapshot.findFirst({
          where: { userId },
          orderBy: { computedForDate: 'desc' },
        }),
        this.prisma.deviationAlert.findMany({
          where: { userId, status: 'OPEN' },
          take: 5,
        }),
        sessionId
          ? this.prisma.session.findUnique({
              where: { id: sessionId },
              select: { summary: true },
            })
          : Promise.resolve(null),
      ])

      // Patient profile
      const profileLines: string[] = []
      if (user?.name) profileLines.push(`Patient name: ${user.name}`)
      if (user?.primaryCondition) profileLines.push(`Primary condition: ${user.primaryCondition}`)
      if (user?.riskTier) profileLines.push(`Risk tier: ${user.riskTier}`)
      if (user?.dateOfBirth) {
        const age = Math.floor(
          (Date.now() - new Date(user.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000),
        )
        profileLines.push(`Age: ${age}`)
      }
      if (user?.preferredLanguage) profileLines.push(`Preferred language: ${user.preferredLanguage}`)
      const profileSummary = profileLines.length > 0
        ? profileLines.join('. ') + '.'
        : 'Patient profile not available.'

      const readingsSummary =
        entries.length > 0
          ? entries
              .map(
                (e) =>
                  `${new Date(e.entryDate).toLocaleDateString()}: ${e.systolicBP ?? '?'}/${e.diastolicBP ?? '?'} mmHg`,
              )
              .join('; ')
          : 'No recent readings'

      // Count entries with complete BP data in the last 7 days
      const completeEntries = entries.filter((e) => e.systolicBP != null && e.diastolicBP != null)
      const entryCount = completeEntries.length

      let baselineSummary: string
      if (baseline) {
        baselineSummary = `7-day baseline: ${baseline.baselineSystolic ?? '?'}/${baseline.baselineDiastolic ?? '?'} mmHg (based on ${entryCount} readings)`
      } else if (entryCount > 0) {
        const remaining = 3 - entryCount
        baselineSummary = `No baseline yet — patient has ${entryCount} reading(s) in the last 7 days, needs ${remaining} more to establish a baseline`
      } else {
        baselineSummary = 'No baseline yet — patient has no readings. Needs at least 3 readings within 7 days to establish a baseline'
      }

      const alertSummary =
        alerts.length > 0
          ? `Active alerts: ${alerts.map((a) => `${a.type} (${a.severity})`).join(', ')}`
          : 'No active alerts'

      const historySummary = sessionData?.summary
        ? `\n\nSESSION HISTORY SUMMARY:\n${sessionData.summary}`
        : ''

      return `${profileSummary}\n\n${readingsSummary}. ${baselineSummary}. ${alertSummary}.${historySummary}`
    } catch {
      return 'Patient context unavailable.'
    }
  }
}
