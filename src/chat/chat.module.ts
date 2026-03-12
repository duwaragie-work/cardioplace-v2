import { Module } from '@nestjs/common'
import { ChatController } from './chat.controller.js'
import { ChatService } from './chat.service.js'
import { SystemPromptService } from './services/system-prompt.service.js'
import { RagService } from './services/rag.service.js'
import { ConversationHistoryService } from './services/conversation-history.service.js'
import { EmergencyDetectionService } from './services/emergency-detection.service.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { MistralModule } from '../mistral/mistral.module.js'

@Module({
  imports: [PrismaModule, MistralModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    SystemPromptService,
    RagService,
    ConversationHistoryService,
    EmergencyDetectionService,
  ],
  exports: [ChatService],
})
export class ChatModule {}
