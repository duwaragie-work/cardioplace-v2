import { Module } from '@nestjs/common'
import { ChatController } from './chat.controller.js'
import { ChatService } from './chat.service.js'
import { SystemPromptService } from './services/system-prompt.service.js'
import { RagService } from './services/rag.service.js'
import { ConversationHistoryService } from './services/conversation-history.service.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { GeminiModule } from '../gemini/gemini.module.js'
import { DailyJournalModule } from '../daily_journal/daily_journal.module.js'

@Module({
  imports: [PrismaModule, GeminiModule, DailyJournalModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    SystemPromptService,
    RagService,
    ConversationHistoryService,
  ],
  exports: [ChatService, ConversationHistoryService, SystemPromptService],
})
export class ChatModule {}
