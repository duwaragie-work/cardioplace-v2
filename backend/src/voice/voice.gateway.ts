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
import { Server, Socket } from 'socket.io'
import { VoiceService } from './voice.service.js'

interface StartSessionPayload {
  sessionId?: string
}

@WebSocketGateway({
  namespace: '/voice',
  pingInterval: 10_000,
  pingTimeout: 15_000,
  cors: {
    origin: (origin: string, callback: (err: Error | null, allow?: boolean) => void) => {
      callback(null, true)
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
      const payload = this.jwtService.verify<{ sub: string }>(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      })
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
        onTranscript: (text: string, isFinal: boolean, speaker: 'user' | 'agent') => {
          if (isFinal && text.trim()) {
            this.logger.log(`[VOICE NestJS→WS] emit transcript [${speaker}] isFinal=${isFinal} "${text.slice(0, 60)}" [socket=${client.id}]`)
          }
          client.emit('transcript', { text, isFinal, speaker })
        },
        onAction: (type: string, detail: string) => {
          this.logger.log(`[VOICE NestJS→WS] emit action type=${type} detail="${detail.slice(0, 80)}" [socket=${client.id}]`)
          client.emit('action', { type, detail })
        },
        onActionComplete: (type: string, success: boolean, detail: string) => {
          this.logger.log(`[VOICE NestJS→WS] emit action_complete type=${type} success=${success} [socket=${client.id}]`)
          client.emit('action_complete', { type, success, detail })
        },
        onCheckinSaved: (summary) => {
          this.logger.log(`[VOICE NestJS→WS] emit checkin_saved BP=${summary.systolicBP}/${summary.diastolicBP} saved=${summary.saved} [socket=${client.id}]`)
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
          this.logger.log(`[VOICE NestJS→WS] emit session_error msg="${message}" [socket=${client.id}]`)
          client.emit('session_error', { message })
        },
        onClose: () => {
          this.logger.log(`[VOICE NestJS→WS] emit session_closed [socket=${client.id}] (total ${Date.now() - sessionStart}ms)`)
          client.emit('session_closed', {})
        },
      },
      authToken,
      chatSessionId,
    )
  }

  @SubscribeMessage('audio_chunk')
  handleAudioChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() audioBase64: string,
  ) {
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
