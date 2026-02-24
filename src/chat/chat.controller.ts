import { Body, Controller, Post, Query, Sse } from '@nestjs/common'
import { Observable } from 'rxjs'
import { ChatService } from './chat.service.js'
import { ChatRequestDto } from './dto/chat-request.dto.js'

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * POST /chat/streaming
   * Returns a Server-Sent Events stream of response tokens.
   * Replaces the getStreamingResponse Firebase Cloud Function.
   */
  @Sse('streaming')
  streamChat(@Query() body: ChatRequestDto): Observable<MessageEvent> {
    return new Observable((observer) => {
      ;(async () => {
        try {
          for await (const chunk of this.chatService.getStreamingResponse(body)) {
            observer.next({ data: chunk } as MessageEvent)
          }
          observer.complete()
        } catch (err) {
          observer.error(err)
        }
      })()
    })
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
