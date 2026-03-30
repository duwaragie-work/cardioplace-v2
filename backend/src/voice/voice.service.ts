import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import * as path from 'path'
import { PrismaService } from '../prisma/prisma.service.js'

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

interface ActiveSession {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: any
  userId: string
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
    mode: 'checkin' | 'chat',
    callbacks: VoiceSessionCallbacks,
    authToken = '',
  ): Promise<void> {
    // Clean up any existing session for this socket
    await this.endSession(socketId)

    const patientContext = await this.buildPatientContext(userId)

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

    this.sessions.set(socketId, { call, userId })

    // ── Handle messages from ADK service ──────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call.on('data', (msg: any) => {
      // With oneofs: true, msg.payload is the string name of the set field
      const payload: string = msg.payload

      if (payload === 'ready') {
        callbacks.onReady()
      } else if (payload === 'audio') {
        // msg.audio.data is a Buffer from protobuf bytes field
        const audioBase64 = Buffer.isBuffer(msg.audio.data)
          ? msg.audio.data.toString('base64')
          : Buffer.from(msg.audio.data).toString('base64')
        callbacks.onAudio(audioBase64)
      } else if (payload === 'transcript') {
        const t = msg.transcript
        callbacks.onTranscript(t.text ?? '', t.isFinal ?? false, (t.speaker as 'user' | 'agent') ?? 'agent')
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
      } else if (payload === 'error') {
        this.logger.warn(`ADK error [socket=${socketId}]: ${msg.error.message}`)
        callbacks.onError(msg.error.message ?? 'Unknown voice service error')
      } else if (payload === 'closed') {
        this.sessions.delete(socketId)
        callbacks.onClose()
      }
    })

    call.on('error', (err: Error) => {
      this.logger.error(`gRPC stream error [socket=${socketId}]`, err.message)
      this.sessions.delete(socketId)
      callbacks.onError('Voice service connection lost. Please try again.')
    })

    call.on('end', () => {
      this.logger.log(`gRPC stream ended [socket=${socketId}]`)
      this.sessions.delete(socketId)
      callbacks.onClose()
    })

    // ── Send SessionInit as first message ─────────────────────────────────────
    call.write({
      init: {
        userId,
        mode,
        patientContext,
        authToken,
      },
    })

    this.logger.log(`Voice session started [socket=${socketId}, user=${userId}, mode=${mode}]`)
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

  async endSession(socketId: string): Promise<void> {
    const session = this.sessions.get(socketId)
    if (!session) return
    try {
      session.call.write({ end: {} })
      session.call.end()
    } catch {
      // Stream may already be closed
    }
    this.sessions.delete(socketId)
    this.logger.log(`Voice session ended [socket=${socketId}]`)
  }

  onModuleDestroy(): void {
    for (const [socketId] of this.sessions) {
      void this.endSession(socketId)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private async buildPatientContext(userId: string): Promise<string> {
    try {
      const [entries, baseline, alerts] = await Promise.all([
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

      return `${readingsSummary}. ${baselineSummary}. ${alertSummary}.`
    } catch {
      return 'Patient context unavailable.'
    }
  }
}
