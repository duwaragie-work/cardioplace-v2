import { Module } from '@nestjs/common'
import { AssignmentController } from './assignment.controller.js'
import { AssignmentService } from './assignment.service.js'
import { ClinicianController } from './clinician.controller.js'
import { EnrollmentController } from './enrollment.controller.js'
import { EnrollmentService } from './enrollment.service.js'
import { MeCareTeamController } from './me-care-team.controller.js'
import { MeThresholdController } from './me-threshold.controller.js'
import { PracticeController } from './practice.controller.js'
import { PracticeService } from './practice.service.js'
import { ThresholdController } from './threshold.controller.js'
import { ThresholdService } from './threshold.service.js'

@Module({
  controllers: [
    PracticeController,
    AssignmentController,
    ClinicianController,
    ThresholdController,
    MeThresholdController,
    MeCareTeamController,
    EnrollmentController,
  ],
  providers: [
    PracticeService,
    AssignmentService,
    ThresholdService,
    EnrollmentService,
  ],
  exports: [
    PracticeService,
    AssignmentService,
    ThresholdService,
    EnrollmentService,
  ],
})
export class PracticeModule {}
