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
    const token =
      (client.handshake.auth as Record<string, string>)?.token ??
      (client.handshake.query as Record<string, string>)?.token

    if (!token) {
      this.logger.warn(`Voice WS rejected — no token [socket=${client.id}]`)
      client.emit('session_error', { message: 'Authentication required' })
      client.disconnect()
      return
    }

    try {
      const payload = this.jwtService.verify<{ sub: string }>(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      })
      client.data = { userId: payload.sub, token }
      this.logger.log(`Voice WS connected [socket=${client.id}, user=${payload.sub}]`)
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

    this.logger.log(`Starting voice session [socket=${client.id}, chatSession=${chatSessionId ?? 'new'}]`)

    await this.voiceService.createSession(
      client.id,
      userId,
      {
        onReady: () => {
          const sessionId = this.voiceService.getSessionId(client.id)
          client.emit('session_ready', { sessionId })
        },
        onAudio: (audioBase64: string) => {
          client.emit('audio_response', { audio: audioBase64 })
        },
        onTranscript: (text: string, isFinal: boolean, speaker: 'user' | 'agent') => {
          client.emit('transcript', { text, isFinal, speaker })
        },
        onAction: (type: string, detail: string) => {
          client.emit('action', { type, detail })
        },
        onCheckinSaved: (summary) => {
          client.emit('checkin_saved', summary)
        },
        onError: (message: string) => {
          client.emit('session_error', { message })
        },
        onClose: () => {
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
    await this.voiceService.endSession(client.id)
    client.emit('session_closed', {})
  }
}
