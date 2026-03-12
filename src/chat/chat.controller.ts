import { Body, Controller, Post, Res, Req, Get, Param, UnauthorizedException } from '@nestjs/common'
import type { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { Public } from '../auth/decorators/public.decorator.js'
import { ChatService } from './chat.service.js'
import { ChatRequestDto } from './dto/chat-request.dto.js'

/**
 * Chat endpoints are publicly accessible (no authentication required).
 * This allows anonymous guest users to chat without logging in.
 */
@Controller('chat')
@Public()
export class ChatController {
  constructor(private readonly chatService: ChatService) { }

  /**
   * POST /chat/streaming
   * Accepts JSON body, streams back tokens as text/event-stream.
   * Client calls this with fetch() and reads the stream.
   */
  @Post('streaming')
  async streamChat(@Body() body: ChatRequestDto, @Req() req: any, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    if (!body.sessionId) {
      body.sessionId = randomUUID()
      const userId = req.user?.id || null
      await this.chatService.createSession(body.sessionId, userId)
      this.chatService.generateSessionTitle(body.sessionId, body.prompt).catch(console.error)
    }

    res.write(`data: ${JSON.stringify({ sessionId: body.sessionId })}\n\n`)

    try {
      const userId = req.user?.id || null
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
  async structuredChat(@Body() body: ChatRequestDto, @Req() req: any) {
    if (!body.sessionId) {
      body.sessionId = randomUUID()
      const userId = req.user?.id || null
      await this.chatService.createSession(body.sessionId, userId)
      this.chatService.generateSessionTitle(body.sessionId, body.prompt).catch(console.error)
    }
    const userId = req.user?.id || null
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
  async getUserSessions(@Req() req: any) {
    if (!req.user?.id) {
      throw new UnauthorizedException('Authentication required to fetch sessions')
    }
    return this.chatService.getUserSessions(req.user.id)
  }

  /**
   * GET /chat/sessions/:sessionId/history
   * Returns the chat history for a specific session.
   */
  @Get('sessions/:sessionId/history')
  async getSessionHistory(@Param('sessionId') sessionId: string, @Req() req: any) {
    const userId = req.user?.id || null
    return this.chatService.getSessionHistory(sessionId, userId)
  }
}
