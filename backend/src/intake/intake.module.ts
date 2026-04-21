import { Module } from '@nestjs/common'
import { AdminIntakeController } from './admin-intake.controller.js'
import { IntakeController } from './intake.controller.js'
import { IntakeService } from './intake.service.js'

@Module({
  controllers: [IntakeController, AdminIntakeController],
  providers: [IntakeService],
  exports: [IntakeService],
})
export class IntakeModule {}
