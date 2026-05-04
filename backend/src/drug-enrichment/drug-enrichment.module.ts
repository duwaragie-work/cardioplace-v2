import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { GeminiModule } from '../gemini/gemini.module.js'
import { DailyMedClient } from './clients/dailymed.client.js'
import { OpenFdaClient } from './clients/openfda.client.js'
import { RxNormClient } from './clients/rxnorm.client.js'
import { DrugEnrichmentController } from './drug-enrichment.controller.js'
import { DrugEnrichmentService } from './drug-enrichment.service.js'

@Module({
  imports: [ConfigModule, GeminiModule],
  controllers: [DrugEnrichmentController],
  providers: [RxNormClient, DailyMedClient, OpenFdaClient, DrugEnrichmentService],
  exports: [DrugEnrichmentService],
})
export class DrugEnrichmentModule {}
