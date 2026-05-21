import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { LangSmithService } from './langsmith.service.js'
import { EmbeddingService } from './embedding.service.js'
import { PatientAccessService } from './patient-access.service.js'

@Global()
@Module({
  imports: [ConfigModule],
  providers: [LangSmithService, EmbeddingService, PatientAccessService],
  exports: [LangSmithService, EmbeddingService, PatientAccessService],
})
export class CommonModule {}
