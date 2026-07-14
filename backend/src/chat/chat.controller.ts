import { Body, Controller, HttpException, HttpStatus, Logger, Post, Res, Req, Get, Param, Delete, UseGuards } from '@nestjs/common'
import type { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { UserRole } from '../generated/prisma/enums.js'
import { ChatService } from './chat.service.js'
import { ChatRequestDto } from './dto/chat-request.dto.js'
import { TranscribeRequestDto, type TranscribeResponse } from './dto/transcribe.dto.js'
import { GeminiService } from '../gemini/gemini.service.js'

/**
 * All chat endpoints require JWT authentication AND PATIENT role.
 * The userId is extracted from the JWT token (req.user.id).
 *
 * Role gate (least privilege): only PATIENT may hit these routes. The global
 * RolesGuard rejects PROVIDER / MEDICAL_DIRECTOR / HEALPLACE_OPS / SUPER_ADMIN
 * with 403 — admin/care-team uses the separate admin app (different surface,
 * different endpoints). This prevents a misissued admin token from being used
 * to invoke the patient chatbot and burning tokens on a profile-less account.
 */
@Controller('chat')
@UseGuards(JwtAuthGuard)
@Roles(UserRole.PATIENT)
export class ChatController {
  private readonly logger = new Logger(ChatController.name)

  constructor(
    private readonly chatService: ChatService,
    private readonly geminiService: GeminiService,
  ) { }

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

    let isNewSession = false
    if (!body.sessionId) {
      body.sessionId = randomUUID()
      await this.chatService.createSession(body.sessionId, userId)
      isNewSession = true
    }

    // Kick title generation off in parallel with the response stream so we can
    // push it back over SSE before [DONE] — no extra round-trip from the client.
    const titlePromise: Promise<string | null> | null = isNewSession
      ? this.chatService.generateSessionTitle(body.sessionId, body.prompt).catch(() => null)
      : null

    res.write(`data: ${JSON.stringify({ sessionId: body.sessionId })}\n\n`)

    try {
      for await (const chunk of this.chatService.getStreamingResponse(body, userId)) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      }
      if (titlePromise) {
        const title = await titlePromise
        if (title) {
          res.write(`data: ${JSON.stringify({ type: 'sessionTitle', sessionId: body.sessionId, title })}\n\n`)
        }
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
    let isNewSession = false
    if (!body.sessionId) {
      body.sessionId = randomUUID()
      await this.chatService.createSession(body.sessionId, userId)
      isNewSession = true
    }

    // Run title generation alongside the main response so the title can be
    // returned in this same JSON body — clients update their sidebar instantly.
    const titlePromise: Promise<string | null> | null = isNewSession
      ? this.chatService.generateSessionTitle(body.sessionId, body.prompt).catch(() => null)
      : null

    const response = await this.chatService.getStructuredResponse(body, userId)
    const title = titlePromise ? await titlePromise : null

    return {
      sessionId: body.sessionId,
      data: response.text,
      isEmergency: response.isEmergency,
      emergencySituation: response.emergencySituation,
      toolResults: response.toolResults,
      title,
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
  @Get('sessions/:sessionId')
  async getSession(@Param('sessionId') sessionId: string, @Req() req: Request) {
    const userId = (req.user as { id: string }).id
    return this.chatService.getSession(sessionId, userId)
  }

  @Get('sessions/:sessionId/history')
  async getSessionHistory(@Param('sessionId') sessionId: string, @Req() req: Request) {
    const userId = (req.user as { id: string }).id
    return this.chatService.getSessionHistory(sessionId, userId)
  }

  @Delete('sessions/:sessionId')
  async deleteSession(@Param('sessionId') sessionId: string, @Req() req: Request) {
    const userId = (req.user as { id: string }).id
    return this.chatService.deleteSession(sessionId, userId)
  }

  /**
   * POST /chat/transcribe
   * Patient dictates into the chat input — browser MediaRecorder captures
   * audio, base64-encodes the blob, and POSTs it here. Backend forwards to
   * Gemini for transcription and returns the text so the frontend can fill
   * the textarea for review-then-Send.
   *
   * Uses the same GeminiService.transcribeAudio path the voice service uses
   * for transcript persistence — consistent quality, consistent surface,
   * consistent cost model. Works on Firefox + iOS Safari where the browser
   * Web Speech API isn't available.
   *
   * Body validation:
   *   • audioBase64 capped at ~10 MB raw audio (see TranscribeRequestDto)
   *   • mimeType allow-listed to formats Gemini accepts
   *   • languageHint optional (BCP-47); narrows the transcription model's prior
   */
  @Post('transcribe')
  async transcribe(
    @Body() body: TranscribeRequestDto,
    @Req() req: Request,
  ): Promise<TranscribeResponse> {
    const userId = (req.user as { id: string }).id
    try {
      const transcript = await this.geminiService.transcribeAudio(
        body.audioBase64,
        body.mimeType,
        body.languageHint,
      )
      return { transcript }
    } catch (err) {
      this.logger.error(
        `transcribe failed userId=${userId} mimeType=${body.mimeType} bytes=${body.audioBase64.length}`,
        err instanceof Error ? err.stack : err,
      )
      throw new HttpException(
        'Transcription failed. Please try again.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }
}
