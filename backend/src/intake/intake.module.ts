import { Module } from '@nestjs/common'
import { DrugEnrichmentModule } from '../drug-enrichment/drug-enrichment.module.js'
import { AdminIntakeController } from './admin-intake.controller.js'
import { IntakeController } from './intake.controller.js'
import { IntakeService } from './intake.service.js'
import { IntakeStatusService } from './intake-status.service.js'

@Module({
  imports: [DrugEnrichmentModule],
  controllers: [IntakeController, AdminIntakeController],
  providers: [IntakeService, IntakeStatusService],
  exports: [IntakeService, IntakeStatusService],
})
export class IntakeModule {}
