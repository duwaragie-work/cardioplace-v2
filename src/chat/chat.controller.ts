import { Body, Controller, Post, Res } from '@nestjs/common'
import type { Response } from 'express'
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
  constructor(private readonly chatService: ChatService) {}

  /**
   * POST /chat/streaming
   * Accepts JSON body, streams back tokens as text/event-stream.
   * Client calls this with fetch() and reads the stream.
   */
  @Post('streaming')
  async streamChat(@Body() body: ChatRequestDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    try {
      for await (const chunk of this.chatService.getStreamingResponse(body)) {
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
  async structuredChat(@Body() body: ChatRequestDto) {
    const response = await this.chatService.getStructuredResponse(body)
    return { data: response.text }
  }
}
