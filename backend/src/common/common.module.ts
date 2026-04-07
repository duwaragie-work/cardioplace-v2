import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { GeminiModule } from '../gemini/gemini.module.js'
import { LangSmithService } from './langsmith.service.js'
import { EmbeddingService } from './embedding.service.js'

@Global()
@Module({
  imports: [ConfigModule, GeminiModule],
  providers: [LangSmithService, EmbeddingService],
  exports: [LangSmithService, EmbeddingService],
})
export class CommonModule {}
