import { Body, Controller, Post, Res, Req, Get, Param, UseGuards } from '@nestjs/common'
import type { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { ChatService } from './chat.service.js'
import { ChatRequestDto } from './dto/chat-request.dto.js'

/**
 * All chat endpoints require JWT authentication.
 * The userId is extracted from the JWT token (req.user.id).
 */
@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) { }

  /**
   * POST /chat/streaming
   * Accepts JSON body, streams back tokens as text/event-stream.
   * Client calls this with fetch() and reads the stream.
   */
  @Post('streaming')
  async streamChat(@Body() body: ChatRequestDto, @Req() req: Request, @Res() res: Response) {
    const userId = (req.user as { id: string }).id
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    if (!body.sessionId) {
      body.sessionId = randomUUID()
      await this.chatService.createSession(body.sessionId, userId)
      this.chatService.generateSessionTitle(body.sessionId, body.prompt).catch(console.error)
    }

    res.write(`data: ${JSON.stringify({ sessionId: body.sessionId })}\n\n`)

    try {
      for await (const chunk of this.chatService.getStreamingResponse(body, userId)) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      }
      res.write('data: [DONE]\n\n')
      res.end()
    } catch (_err) {
      res.write(`data: ${JSON.stringify({ error: 'An error occurred' })}\n\n`)
      res.end()
    }
  }

  /**
   * POST /chat/structured
   * Returns the complete AI response as JSON.
   * Replaces the getStructuredResponse Firebase Cloud Function.
   */
  @Post('structured')
  async structuredChat(@Body() body: ChatRequestDto, @Req() req: Request) {
    const userId = (req.user as { id: string }).id
    if (!body.sessionId) {
      body.sessionId = randomUUID()
      await this.chatService.createSession(body.sessionId, userId)
      this.chatService.generateSessionTitle(body.sessionId, body.prompt).catch(console.error)
    }
    const response = await this.chatService.getStructuredResponse(body, userId)
    return {
      sessionId: body.sessionId,
      data: response.text,
      isEmergency: response.isEmergency,
      emergencySituation: response.emergencySituation,
    }
  }

  /**
   * GET /chat/sessions
   * Returns a list of chat sessions owned by the authenticated user.
   */
  @Get('sessions')
  async getUserSessions(@Req() req: Request) {
    const userId = (req.user as { id: string }).id
    return this.chatService.getUserSessions(userId)
  }

  /**
   * GET /chat/sessions/:sessionId/history
   * Returns the chat history for a specific session.
   */
  @Get('sessions/:sessionId/history')
  async getSessionHistory(@Param('sessionId') sessionId: string, @Req() req: Request) {
    const userId = (req.user as { id: string }).id
    return this.chatService.getSessionHistory(sessionId, userId)
  }
}
