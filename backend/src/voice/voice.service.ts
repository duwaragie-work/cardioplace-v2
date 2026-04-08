import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { PrismaService } from '../prisma/prisma.service.js'
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

interface ActiveSession {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: any
  userId: string
  sessionId: string
  transcriptBuffer: TranscriptEntry[]
  activity: SessionActivity
  callbacks: VoiceSessionCallbacks
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
      callbacks,
    }
    this.sessions.set(socketId, activeSession)

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
        this.saveVoiceTranscript(socketId)
          .then(() => {
            this.sessions.delete(socketId)
            callbacks.onClose()
          })
      }
    })

    call.on('error', (err: Error) => {
      this.logger.error(`gRPC stream error [socket=${socketId}]`, err.message)
      this.saveVoiceTranscript(socketId)
        .then(() => {
          this.sessions.delete(socketId)
          callbacks.onError('Voice service connection lost. Please try again.')
        })
    })

    call.on('end', () => {
      this.logger.log(`gRPC stream ended [socket=${socketId}]`)
      this.saveVoiceTranscript(socketId)
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

      let readingsSummary: string
      if (entries.length > 0) {
        const lines = entries.map((e) => {
          const date = new Date(e.entryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          const time = e.measurementTime ?? 'unknown time'
          const bp = (e.systolicBP != null && e.diastolicBP != null) ? `${e.systolicBP}/${e.diastolicBP} mmHg` : 'not recorded'
          const weight = e.weight != null ? `${e.weight} lbs` : 'no weight'
          const meds = e.medicationTaken === true ? 'meds taken' : e.medicationTaken === false ? 'meds missed' : 'meds unknown'
          const symptoms = (e.symptoms as string[] | null)?.length ? (e.symptoms as string[]).join(', ') : 'no symptoms'
          return `- ${date} at ${time}: BP ${bp}, ${weight}, ${meds}, ${symptoms}`
        })
        readingsSummary = 'Recent BP readings (last 7 days):\n' + lines.join('\n')
      } else {
        readingsSummary = 'No recent readings'
      }

      const completeEntries = entries.filter((e) => e.systolicBP != null && e.diastolicBP != null)
      const entryCount = completeEntries.length

      let baselineSummary: string
      if (baseline) {
        baselineSummary = `7-day baseline: ${baseline.baselineSystolic ?? '?'}/${baseline.baselineDiastolic ?? '?'} mmHg (based on ${entryCount} readings)`
      } else if (entryCount >= 3) {
        baselineSummary = `No baseline yet — ${entryCount} readings recorded, baseline should be available shortly (may need readings on 3 different days)`
      } else if (entryCount > 0) {
        const remaining = 3 - entryCount
        baselineSummary = `No baseline yet — ${entryCount} of 3 required readings recorded, needs ${remaining} more on different days within 7 days`
      } else {
        baselineSummary = 'No baseline yet — 0 of 3 required readings recorded (needs readings on 3 different days within 7 days)'
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
