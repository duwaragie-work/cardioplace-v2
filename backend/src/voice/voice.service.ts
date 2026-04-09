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
  actions: Array<{ type: string; detail: string; timestamp: number }>
}

interface ActiveSession {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: any
  userId: string
  sessionId: string
  transcriptBuffer: TranscriptEntry[]
  activity: SessionActivity
  callbacks: VoiceSessionCallbacks
  savedTranscript: boolean
  streamEnded: boolean
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
      {
        'grpc.keepalive_time_ms': 30_000,
        'grpc.keepalive_timeout_ms': 10_000,
        'grpc.keepalive_permit_without_calls': 1,
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
      streamEnded: false,
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
        this.saveVoiceTranscript(socketId)
          .then(() => {
            this.sessions.delete(socketId)
            callbacks.onClose()
          })
      }
    })

    call.on('error', (err: Error) => {
      this.logger.error(`gRPC stream error [socket=${socketId}]`, err.message)
      const errSess = this.sessions.get(socketId)
      if (errSess) errSess.streamEnded = true
      this.saveVoiceTranscript(socketId)
        .then(() => {
          this.sessions.delete(socketId)
          callbacks.onError('Voice service connection lost. Please try again.')
        })
    })

    call.on('end', () => {
      this.logger.log(`gRPC stream ended [socket=${socketId}]`)
      const endSess = this.sessions.get(socketId)
      if (endSess) endSess.streamEnded = true
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
    if (!session || session.streamEnded) return
    try {
      const data = Buffer.from(audioBase64, 'base64')
      session.call.write({
        audio: { data, mimeType: 'audio/pcm;rate=16000' },
      })
    } catch (err) {
      this.logger.error('Failed to forward audio to ADK service', err)
      session.callbacks.onError('Voice connection lost. Please try again.')
      void this.endSession(socketId)
    }
  }

  sendText(socketId: string, text: string): void {
    const session = this.sessions.get(socketId)
    if (!session || session.streamEnded) return
    try {
      session.call.write({ text: { text } })
      // Track user text input in activity
      if (text.trim()) {
        session.activity.userTexts.push(text.trim())
      }
    } catch (err) {
      this.logger.error('Failed to forward text to ADK service', err)
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
    if (session.savedTranscript) {
      this.logger.log(`saveVoiceTranscript [socket=${socketId}] — already saved, skipping`)
      return
    }
    session.savedTranscript = true

    const { transcriptBuffer, activity } = session

    this.logger.log(
      `saveVoiceTranscript [socket=${socketId}] transcripts=${transcriptBuffer.length} ` +
      `userTexts=${activity.userTexts.length} agentTexts=${activity.agentTexts.length} checkins=${activity.checkins.length} actions=${activity.actions.length} actionTypes=${activity.actions.map(a => a.type).join(',')}`,
    )

    // Take snapshots and clear
    const buffer = [...transcriptBuffer]
    session.transcriptBuffer = []
    const activitySnapshot = {
      userTexts: [...activity.userTexts],
      agentTexts: [...activity.agentTexts],
      checkins: [...activity.checkins],
      actions: [...activity.actions],
    }
    session.activity = { userTexts: [], agentTexts: [], checkins: [], actions: [] }

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
        // No data at all — skip (another call may have already saved)
        if (activitySnapshot.actions.length === 0 && activitySnapshot.checkins.length === 0) {
          // Check if summary already exists from a previous call
          const existing = await this.prisma.session.findUnique({
            where: { id: session.sessionId },
            select: { summary: true },
          })
          if (existing?.summary) {
            this.logger.log(`Summary already saved for session [socket=${socketId}] — skipping`)
            return
          }
          // Truly nothing happened
          this.logger.log(`No data to save for voice session [socket=${socketId}]`)
          await this.prisma.session.update({
            where: { id: session.sessionId },
            data: { summary: '- Voice conversation about cardiovascular health', title: 'Voice Chat' },
          }).catch(() => {})
          return
        }

        this.logger.log(`No transcript lines for voice session [socket=${socketId}] — generating summary from ${activitySnapshot.actions.length} actions, ${activitySnapshot.checkins.length} checkins`)

        const summaryParts: string[] = []
        let title = 'Voice Chat'

        for (const action of activitySnapshot.actions) {
          if (action.type === 'fetching_readings') {
            summaryParts.push(`- Patient requested to view past BP readings (${action.detail || 'last 7 days'})`)
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

        const basicSummary = summaryParts.join('\n')
        this.logger.log(`[SUMMARY SAVING] session=${session.sessionId} summary="${basicSummary}" title="${title}"`)

        await this.prisma.session.update({
          where: { id: session.sessionId },
          data: { summary: basicSummary, title },
        }).catch((err) => this.logger.error('Failed to save summary', err))
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
            timezone: true,
            communicationPreference: true,
          },
        }),
        this.prisma.journalEntry.findMany({
          where: { userId },
          orderBy: { entryDate: 'desc' },
          select: {
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
          lines.push(`- ${date} at ${time}: ${bp}, Medication: ${med}${wt}${sym}`)
        }
      }

      // ── Baseline ───────────────────────────────────────────────────────────
      lines.push('')
      const completeEntries = entries.filter((e) => e.systolicBP != null && e.diastolicBP != null)
      const entryCount = completeEntries.length
      if (baseline && baseline.baselineSystolic != null && baseline.baselineDiastolic != null) {
        lines.push(
          `Baseline: ${Number(baseline.baselineSystolic)}/${Number(baseline.baselineDiastolic)} mmHg`,
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
