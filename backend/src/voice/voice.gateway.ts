import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets'
import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { redactText } from '../common/logging/log-redact.js'
import { Server, Socket } from 'socket.io'
import { VoiceService } from './voice.service.js'

interface StartSessionPayload {
  sessionId?: string
  /**
   * IANA timezone string from `Intl.DateTimeFormat().resolvedOptions().timeZone`
   * on the client. When present and valid, the backend uses this for "now"
   * resolution in voice check-ins instead of the stored User.timezone — so
   * a patient travelling away from their registered timezone still gets
   * measuredAt that matches their browser's wall clock.
   */
  clientTimezone?: string
}

/**
 * Allowed WebSocket origins — mirrors the HTTP CORS allow-list in main.ts so
 * voice stays in lockstep with normal API CORS across every environment.
 * Read from env at connection time, so prod / dev / local each enforce their
 * own `WEB_APP_URL` with no hardcoded domains.
 */
function voiceCorsAllowedOrigins(): string[] {
  return (process.env.WEB_APP_URL ?? 'http://localhost:3000,http://localhost:3001')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

@WebSocketGateway({
  namespace: '/voice',
  pingInterval: 10_000,
  pingTimeout: 15_000,
  cors: {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // No Origin header → non-browser client (e.g. native/mobile voice). These
      // can't mount a CSRF-style cross-site attack, so allow them through.
      if (!origin) {
        callback(null, true)
        return
      }
      callback(null, voiceCorsAllowedOrigins().includes(origin))
    },
    credentials: true,
  },
})
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server

  private readonly logger = new Logger(VoiceGateway.name)

  constructor(
    private readonly voiceService: VoiceService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    const t0 = Date.now()
    const token =
      (client.handshake.auth as Record<string, string>)?.token ??
      (client.handshake.query as Record<string, string>)?.token

    if (!token) {
      this.logger.warn(`[FLOW] Step 2 FAIL — no token [socket=${client.id}] (${Date.now() - t0}ms)`)
      client.emit('session_error', { message: 'Authentication required' })
      client.disconnect()
      return
    }

    try {
      const payload = this.jwtService.verify<{ sub: string; roles?: string[] }>(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      })
      // Role gate (least privilege): voice is a patient-only surface. A
      // misissued PROVIDER / MEDICAL_DIRECTOR / SUPER_ADMIN token must not
      // be able to open a voice session and burn LLM tokens against an
      // account that has no PatientProfile. Mirrors @Roles(UserRole.PATIENT)
      // on the HTTP controllers.
      const roles = Array.isArray(payload.roles) ? payload.roles : []
      if (!roles.includes('PATIENT')) {
        this.logger.warn(
          `[SECURITY] voice_role_denied user=${payload.sub} roles=${roles.join(',')} [socket=${client.id}]`,
        )
        client.emit('session_error', { message: 'Voice is a patient-only surface' })
        client.disconnect()
        return
      }
      client.data = { userId: payload.sub, token }
      this.logger.log(`[FLOW] Step 2 — WS connected + JWT verified [socket=${client.id}, user=${payload.sub}] (${Date.now() - t0}ms)`)
    } catch {
      this.logger.warn(`Voice WS rejected — invalid token [socket=${client.id}]`)
      client.emit('session_error', { message: 'Invalid or expired token' })
      client.disconnect()
    }
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Voice WS disconnected [socket=${client.id}]`)
    await this.voiceService.endSession(client.id)
  }

  @SubscribeMessage('start_session')
  async handleStartSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: StartSessionPayload,
  ) {
    const data = client.data as { userId?: string; token?: string }
    const userId = data?.userId
    if (!userId) {
      client.emit('session_error', { message: 'Not authenticated' })
      return
    }

    const authToken = data?.token ?? ''
    const chatSessionId = payload?.sessionId
    const clientTimezone = typeof payload?.clientTimezone === 'string' ? payload.clientTimezone : undefined

    const sessionStart = Date.now()
    this.logger.log(`[FLOW] Step 3 START — creating session [socket=${client.id}, chatSession=${chatSessionId ?? 'new'}]`)

    await this.voiceService.createSession(
      client.id,
      userId,
      {
        onReady: () => {
          const sessionId = this.voiceService.getSessionId(client.id)
          this.logger.log(`[VOICE NestJS→WS] emit session_ready [socket=${client.id}] (${Date.now() - sessionStart}ms)`)
          client.emit('session_ready', { sessionId })
        },
        onAudio: (audioBase64: string) => {
          if (process.env.VOICE_DEBUG_AUDIO === '1') {
            this.logger.log(`[VOICE NestJS→WS] emit audio_response bytes=${audioBase64.length} [socket=${client.id}]`)
          }
          client.emit('audio_response', { audio: audioBase64 })
        },
        onGenerationComplete: () => {
          if (process.env.VOICE_DEBUG_AUDIO === '1') {
            this.logger.log(`[VOICE NestJS→WS] emit agent_generation_complete [socket=${client.id}]`)
          }
          client.emit('agent_generation_complete', {})
        },
        onInterrupted: () => {
          this.logger.log(`[VOICE NestJS→WS] emit agent_interrupted [socket=${client.id}]`)
          client.emit('agent_interrupted', {})
        },
        onTranscript: (text: string, isFinal: boolean, speaker: 'user' | 'agent') => {
          if (isFinal && text.trim()) {
            // V-05: `text` is the patient's verbatim speech. speaker/isFinal +
            // the length are the flow signal; the words were pure disclosure.
            this.logger.log(`[VOICE NestJS→WS] emit transcript [${speaker}] isFinal=${isFinal} ${redactText(text)} [socket=${client.id}]`)
          }
          client.emit('transcript', { text, isFinal, speaker })
        },
        onAction: (type: string, detail: string) => {
          // V-05: `detail` is clinical narrative. type= is the signal — mirrors
          // the action_complete line below, which already logs type= only.
          this.logger.log(`[VOICE NestJS→WS] emit action type=${type} detail=${redactText(detail)} [socket=${client.id}]`)
          client.emit('action', { type, detail })
        },
        onActionComplete: (type: string, success: boolean, detail: string) => {
          this.logger.log(`[VOICE NestJS→WS] emit action_complete type=${type} success=${success} [socket=${client.id}]`)
          client.emit('action_complete', { type, success, detail })
        },
        onCheckinSaved: (summary) => {
          // V-05: this printed the patient's blood pressure literally. saved=
          // + entryId are what the flow trace needs; the reading is PHI and is
          // already persisted (and audited) on JournalEntry.
          this.logger.log(`[VOICE NestJS→WS] emit checkin_saved saved=${summary.saved} [socket=${client.id}]`)
          this.voiceService.invalidateContextCache(userId)
          client.emit('checkin_saved', summary)
        },
        onCheckinUpdated: (summary) => {
          this.logger.log(`[VOICE NestJS→WS] emit checkin_updated entryId=${summary.entryId} updated=${summary.updated} [socket=${client.id}]`)
          this.voiceService.invalidateContextCache(userId)
          client.emit('checkin_updated', summary)
        },
        onCheckinDeleted: (summary) => {
          this.logger.log(`[VOICE NestJS→WS] emit checkin_deleted count=${summary.deletedCount}/${summary.failedCount} success=${summary.success} [socket=${client.id}]`)
          this.voiceService.invalidateContextCache(userId)
          client.emit('checkin_deleted', summary)
        },
        onError: (message: string) => {
          // V-05: session_error messages can echo model/tool text back, so the
          // body is treated as untrusted for PHI.
          this.logger.log(`[VOICE NestJS→WS] emit session_error msg=${redactText(message)} [socket=${client.id}]`)
          client.emit('session_error', { message })
        },
        onClose: () => {
          this.logger.log(`[VOICE NestJS→WS] emit session_closed [socket=${client.id}] (total ${Date.now() - sessionStart}ms)`)
          client.emit('session_closed', {})
        },
      },
      authToken,
      chatSessionId,
      clientTimezone,
    )
  }

  @SubscribeMessage('audio_chunk')
  handleAudioChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() audioBytes: ArrayBuffer | Buffer | string,
  ) {
    // Frontend now sends raw Int16 PCM as a binary Socket.io frame (cheaper
    // than the previous base64 string — skips main-thread btoa AND ~33% wire
    // bloat). Fall back to string for compatibility if any old client is
    // still attached. voice.service expects base64.
    let audioBase64: string
    if (typeof audioBytes === 'string') {
      audioBase64 = audioBytes
    } else if (Buffer.isBuffer(audioBytes)) {
      audioBase64 = audioBytes.toString('base64')
    } else {
      audioBase64 = Buffer.from(audioBytes).toString('base64')
    }
    this.voiceService.sendAudio(client.id, audioBase64)
  }

  // Client-side VAD tells us the user just paused for > 400ms. Forward the
  // signal so Gemini finalises the turn instead of waiting for its own silence
  // detection. Shaves ~300-500ms off every reply.
  @SubscribeMessage('audio_stream_end')
  handleAudioStreamEnd(@ConnectedSocket() client: Socket) {
    this.voiceService.sendAudioStreamEnd(client.id)
  }

  @SubscribeMessage('text_input')
  handleTextInput(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { text: string },
  ) {
    if (payload?.text) {
      this.voiceService.sendText(client.id, payload.text)
    }
  }

  @SubscribeMessage('end_session')
  async handleEndSession(@ConnectedSocket() client: Socket) {
    this.logger.log(`[VOICE WS] end_session received [socket=${client.id}]`)
    await this.voiceService.endSession(client.id)
    client.emit('session_closed', {})
  }
}
