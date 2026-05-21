import { Module } from '@nestjs/common'
import { AdminCaregiverController } from './admin-caregiver.controller.js'
import { CaregiverController } from './caregiver.controller.js'
import { CaregiverService } from './caregiver.service.js'

@Module({
  controllers: [CaregiverController, AdminCaregiverController],
  providers: [CaregiverService],
  exports: [CaregiverService],
})
export class CaregiverModule {}
