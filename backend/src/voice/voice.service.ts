import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { PrismaService } from '../prisma/prisma.service.js'
import { ConversationHistoryService } from '../chat/services/conversation-history.service.js'
import { GeminiService } from '../gemini/gemini.service.js'

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
  userAudioChunks: Buffer[]
  agentAudioChunks: Buffer[]
  userAudioBytes: number
  agentAudioBytes: number
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
    private readonly geminiService: GeminiService,
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
      activity: { userTexts: [], agentTexts: [], checkins: [], actions: [] },
      savedTranscript: false,
      streamClosed: false,
      userAudioChunks: [],
      agentAudioChunks: [],
      userAudioBytes: 0,
      agentAudioBytes: 0,
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
        // Buffer agent audio for post-session transcription
        if (activeSession.agentAudioBytes < MAX_AUDIO_BYTES) {
          activeSession.agentAudioChunks.push(rawData)
          activeSession.agentAudioBytes += rawData.length
        }
        const audioBase64 = rawData.toString('base64')
        callbacks.onAudio(audioBase64)
      } else if (payload === 'transcript') {
        const t = msg.transcript
        const text: string = t.text ?? ''
        const isFinal: boolean = t.isFinal ?? false
        const speaker = (t.speaker as 'user' | 'agent') ?? 'agent'
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
        this.logger.log(`[ACTION RECEIVED] type=${actionType} detail=${actionDetail} socket=${socketId}`)
        callbacks.onAction(actionType, actionDetail)
        // Track action for summary
        const sess = this.sessions.get(socketId)
        if (sess) {
          sess.activity.actions.push({ type: actionType, detail: actionDetail, timestamp: Date.now() })
          this.logger.log(`[ACTION TRACKED] total actions=${sess.activity.actions.length}`)
        }
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
        activeSession.streamClosed = true
        this.saveVoiceTranscript(socketId)
          .then(() => {
            this.sessions.delete(socketId)
            callbacks.onClose()
          })
      }
    })

    call.on('error', (err: Error) => {
      this.logger.error(`gRPC stream error [socket=${socketId}]`, err.message)
      activeSession.streamClosed = true
      this.saveVoiceTranscript(socketId)
        .then(() => {
          this.sessions.delete(socketId)
          callbacks.onError('Voice service connection lost. Please try again.')
        })
    })

    call.on('end', () => {
      this.logger.log(`gRPC stream ended [socket=${socketId}]`)
      activeSession.streamClosed = true
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

  getSessionId(socketId: string): string | undefined {
    return this.sessions.get(socketId)?.sessionId
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
    const session = this.sessions.get(socketId)
    if (!session) return
    if (session.savedTranscript) {
      this.logger.log(`saveVoiceTranscript [socket=${socketId}] — already saved, skipping`)
      return
    }
    session.savedTranscript = true

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

      this.logger.log(`Saved voice transcript [session=${session.sessionId}, title=${title}]`)
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
            timezone: true,
            communicationPreference: true,
          },
        }),
        this.prisma.journalEntry.findMany({
          where: { userId },
          orderBy: { entryDate: 'desc' },
          select: {
            id: true,
            entryDate: true,
            systolicBP: true,
            diastolicBP: true,
            weight: true,
            medicationTaken: true,
            measurementTime: true,
            symptoms: true,
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
          take: 5,
        }),
        sessionId
          ? this.prisma.session.findUnique({
              where: { id: sessionId },
              select: { summary: true },
            })
          : Promise.resolve(null),
      ])

      // ── Profile ────────────────────────────────────────────────────────────
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

      // ── BP readings (all entries, Decimal→Number) ─────────────────────────
      const lines: string[] = ['--- PATIENT HEALTH DATA (HISTORICAL — do NOT treat as current conversation input) ---']
      lines.push(`All BP readings (${entries.length} total):`)
      if (entries.length === 0) {
        lines.push('- No readings recorded yet')
      } else {
        for (const e of entries) {
          const date = new Date(e.entryDate).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
          })
          const time = e.measurementTime ?? 'unknown time'
          const sys = e.systolicBP != null ? Number(e.systolicBP) : null
          const dia = e.diastolicBP != null ? Number(e.diastolicBP) : null
          const bp = sys != null && dia != null ? `${sys}/${dia} mmHg` : 'not recorded'
          const med =
            e.medicationTaken === true
              ? 'taken'
              : e.medicationTaken === false
                ? 'missed'
                : 'not recorded'
          const wt = e.weight != null ? `, Weight: ${Number(e.weight)} lbs` : ''
          const sym = (e.symptoms as string[] | null)?.length ? `, Symptoms: ${(e.symptoms as string[]).join(', ')}` : ''
          lines.push(`- [entry_id="${e.id}"] ${date} at ${time}: ${bp}, Medication: ${med}${wt}${sym}`)
        }
      }

      // ── Baseline ───────────────────────────────────────────────────────────
      lines.push('')
      const completeEntries = entries.filter((e) => e.systolicBP != null && e.diastolicBP != null)
      const entryCount = completeEntries.length
      const bSys = baseline ? Number(baseline.baselineSystolic) : 0
      const bDia = baseline ? Number(baseline.baselineDiastolic) : 0
      if (bSys > 0 && bDia > 0) {
        lines.push(
          `Baseline: ${bSys}/${bDia} mmHg`,
        )
      } else if (entryCount >= 3) {
        lines.push(
          `Baseline: Not yet computed (${entryCount} readings recorded — baseline should be available shortly, may need readings on 3 different days)`,
        )
      } else if (entryCount > 0) {
        const remaining = 3 - entryCount
        lines.push(
          `Baseline: Not yet established — ${entryCount} of 3 required readings recorded (needs ${remaining} more on different days within 7 days)`,
        )
      } else {
        lines.push('Baseline: Not yet established — 0 of 3 required readings recorded (needs readings on 3 different days within 7 days)')
      }

      // ── Alerts (aligned filter: acknowledgedAt: null) ─────────────────────
      lines.push('')
      if (alerts.length === 0) {
        lines.push('Active alerts: None')
      } else {
        lines.push('Active alerts:')
        for (const alert of alerts) {
          lines.push(`- ${alert.type} (${alert.severity})`)
        }
      }

      // ── Communication preference ──────────────────────────────────────────
      lines.push('')
      lines.push(`Communication preference: ${user?.communicationPreference || 'Not set'}`)

      lines.push('--- END PATIENT DATA ---')

      // ── Current date/time in patient timezone ─────────────────────────────
      const tz = user?.timezone ?? 'America/New_York'
      this.logger.log(`[TIMEZONE] user=${userId} stored=${user?.timezone ?? 'null'} using=${tz} now=${new Date().toISOString()}`)
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

      const historySummary = sessionData?.summary
        ? `\n\nSESSION HISTORY SUMMARY:\n${sessionData.summary}`
        : ''

      return `${profileSummary}\n\n${lines.join('\n')}\n\nCURRENT DATE AND TIME (patient timezone ${tz}): ${currentDate} at ${currentTime}. When the patient says "now", "today", or "right now", use EXACTLY this date and time. NEVER guess a different date or time.${historySummary}`
    } catch {
      return 'Patient context unavailable.'
    }
  }
}
