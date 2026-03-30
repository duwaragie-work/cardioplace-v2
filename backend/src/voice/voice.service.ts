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
   * Summarise the accumulated voice transcript via Mistral and save the
   * summary (not raw lines) to the Conversation table.
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

      // Ask Mistral to summarise in 3-5 sentences
      const result = await this.mistral.getChatCompletion([
        {
          role: 'system',
          content:
            'You are a medical scribe. Summarise the following voice conversation between a cardiovascular patient and an AI health assistant in 3–5 concise sentences. ' +
            'Capture: topics discussed, any BP or weight values mentioned, medication status, symptoms reported, and any advice or next steps given. ' +
            'Write in past tense, third-person ("The patient…"). Return only the summary, no headings.',
        },
        { role: 'user', content: raw },
      ])

      const summary =
        (result.choices?.[0]?.message?.content as string | undefined)?.trim() ||
        raw.slice(0, 500)

      await (this.prisma as any).$executeRawUnsafe(
        `INSERT INTO "Conversation" (id, "sessionId", "userMessage", "aiResponse", source, timestamp)
         VALUES (gen_random_uuid(), $1, '[Voice session]', $2, 'voice', NOW())`,
        session.sessionId,
        summary,
      )

      // Immediately invalidate the summary cache so the next text message
      // picks up this voice session without waiting for the 5-minute TTL.
      this.conversationHistory.invalidateSummaryCache(session.sessionId)

      this.logger.log(`Saved voice session summary [session=${session.sessionId}]`)
    } catch (err) {
      this.logger.error('Failed to save voice transcript summary', err)
    }
  }

  private async buildPatientContext(userId: string, sessionId?: string): Promise<string> {
    try {
      const [entries, baseline, alerts, recentConversations] = await Promise.all([
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
          ? (this.prisma as any).$queryRawUnsafe(
              `SELECT "userMessage", "aiResponse", source, timestamp
               FROM "Conversation"
               WHERE "sessionId" = $1
               ORDER BY timestamp DESC
               LIMIT 6`,
              sessionId,
            ) as Promise<Array<{ userMessage: string; aiResponse: string; source: string; timestamp: Date }>>
          : Promise.resolve([]),
      ])

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

      let historySummary = ''
      if (recentConversations.length > 0) {
        const sorted = [...recentConversations].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        )
        const lines = sorted
          .slice(-4)
          .map((c) => {
            const label = c.source === 'voice' ? 'Voice session summary' : 'Chat'
            // Voice rows have aiResponse = the full summary; text rows have a Q&A pair
            return c.source === 'voice'
              ? `[${label}]: ${c.aiResponse.slice(0, 300)}`
              : `[${label}] Patient: ${c.userMessage.slice(0, 100)} → AI: ${c.aiResponse.slice(0, 100)}`
          })
          .join('\n')
        historySummary = `\n\nRECENT SESSION HISTORY:\n${lines}`
      }

      return `${readingsSummary}. ${baselineSummary}. ${alertSummary}.${historySummary}`
    } catch {
      return 'Patient context unavailable.'
    }
  }
}
