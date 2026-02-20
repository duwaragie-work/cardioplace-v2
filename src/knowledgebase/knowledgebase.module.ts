import { Module } from '@nestjs/common'
import { MistralModule } from '../mistral/mistral.module.js'
import { KnowledgebaseController } from './knowledgebase.controller.js'
import { KnowledgebaseService } from './knowledgebase.service.js'

@Module({
  imports: [MistralModule],
  controllers: [KnowledgebaseController],
  providers: [KnowledgebaseService],
})
export class KnowledgebaseModule {}
