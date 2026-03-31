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

interface TranscriptEntry {
  speaker: 'user' | 'agent'
  text: string
}

interface ActiveSession {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: any
  userId: string
  sessionId: string
  transcriptBuffer: TranscriptEntry[]
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

    const activeSession: ActiveSession = { call, userId, sessionId, transcriptBuffer: [] }
    this.sessions.set(socketId, activeSession)

    // ── Handle messages from ADK service ──────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call.on('data', (msg: any) => {
      const payload: string = msg.payload

      if (payload === 'ready') {
        callbacks.onReady()
      } else if (payload === 'audio') {
        const audioBase64 = Buffer.isBuffer(msg.audio.data)
          ? msg.audio.data.toString('base64')
          : Buffer.from(msg.audio.data).toString('base64')
        callbacks.onAudio(audioBase64)
      } else if (payload === 'transcript') {
        const t = msg.transcript
        const text: string = t.text ?? ''
        const isFinal: boolean = t.isFinal ?? false
        const speaker = (t.speaker as 'user' | 'agent') ?? 'agent'
        callbacks.onTranscript(text, isFinal, speaker)
        // Accumulate final transcript lines for persistence
        if (isFinal && text.trim()) {
          const sess = this.sessions.get(socketId)
          if (sess) {
            sess.transcriptBuffer.push({ speaker, text: text.trim() })
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
        // Save transcript when check-in completes
        void this.saveVoiceTranscript(socketId)
      } else if (payload === 'error') {
        this.logger.warn(`ADK error [socket=${socketId}]: ${msg.error.message}`)
        callbacks.onError(msg.error.message ?? 'Unknown voice service error')
      } else if (payload === 'closed') {
        void this.saveVoiceTranscript(socketId)
        this.sessions.delete(socketId)
        callbacks.onClose()
      }
    })

    call.on('error', (err: Error) => {
      this.logger.error(`gRPC stream error [socket=${socketId}]`, err.message)
      void this.saveVoiceTranscript(socketId)
      this.sessions.delete(socketId)
      callbacks.onError('Voice service connection lost. Please try again.')
    })

    call.on('end', () => {
      this.logger.log(`gRPC stream ended [socket=${socketId}]`)
      void this.saveVoiceTranscript(socketId)
      this.sessions.delete(socketId)
      callbacks.onClose()
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
    } catch (err) {
      this.logger.error('Failed to forward audio to ADK service', err)
    }
  }

  sendText(socketId: string, text: string): void {
    const session = this.sessions.get(socketId)
    if (!session) return
    try {
      session.call.write({ text: { text } })
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
    try {
      session.call.write({ end: {} })
      session.call.end()
    } catch {
      // Stream may already be closed
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
  private async saveVoiceTranscript(socketId: string): Promise<void> {
    const session = this.sessions.get(socketId)
    if (!session || session.transcriptBuffer.length === 0) return

    const buffer = [...session.transcriptBuffer]
    session.transcriptBuffer = []

    try {
      // Build readable transcript text
      const raw = buffer
        .map((e) => `${e.speaker === 'user' ? 'Patient' : 'AI'}: ${e.text}`)
        .join('\n')

      // Ask Mistral to produce two-part summary (patient side + AI side)
      const result = await this.mistral.getChatCompletion([
        {
          role: 'system',
          content:
            'You are a medical scribe. From the following voice conversation, produce two separate summaries:\n\n' +
            'PATIENT: Summarise what the patient said, reported, or asked in 2–3 sentences. Include any BP values, weight, medication status, and symptoms they mentioned.\n\n' +
            'AI: Summarise what the AI assistant advised, asked, or confirmed in 2–3 sentences. Include any actions taken (like saving a check-in).\n\n' +
            'Return exactly in this format:\nPATIENT: <summary>\nAI: <summary>\n\nNo other text.',
        },
        { role: 'user', content: raw },
      ])

      const output =
        (result.choices?.[0]?.message?.content as string | undefined)?.trim() || ''

      // Parse the two-part response
      const patientMatch = output.match(/PATIENT:\s*([\s\S]*?)(?=\nAI:|$)/i)
      const aiMatch = output.match(/AI:\s*([\s\S]*)/i)

      const patientSummary = patientMatch?.[1]?.trim() ||
        buffer.filter((e) => e.speaker === 'user').map((e) => e.text).join(' ').slice(0, 300) ||
        '[Voice session — patient audio]'
      const aiSummary = aiMatch?.[1]?.trim() ||
        buffer.filter((e) => e.speaker === 'agent').map((e) => e.text).join(' ').slice(0, 300) ||
        '[Voice session — AI audio]'

      // Delegate to ConversationHistoryService (generates embedding + saves)
      await this.conversationHistory.saveVoiceConversation(
        session.sessionId,
        patientSummary,
        aiSummary,
      )

      this.logger.log(`Saved voice session summary [session=${session.sessionId}]`)
    } catch (err) {
      this.logger.error('Failed to save voice transcript summary', err)
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

      const baselineSummary = baseline
        ? `7-day average: ${baseline.baselineSystolic ?? '?'}/${baseline.baselineDiastolic ?? '?'} mmHg`
        : 'No baseline established yet'

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
