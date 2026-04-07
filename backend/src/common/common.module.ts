import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { LangSmithService } from './langsmith.service.js'
import { EmbeddingService } from './embedding.service.js'

@Global()
@Module({
  imports: [ConfigModule],
  providers: [LangSmithService, EmbeddingService],
  exports: [LangSmithService, EmbeddingService],
})
export class CommonModule {}
