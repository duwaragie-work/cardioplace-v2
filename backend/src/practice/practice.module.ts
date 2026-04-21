import { Module } from '@nestjs/common'
import { AssignmentController } from './assignment.controller.js'
import { AssignmentService } from './assignment.service.js'
import { EnrollmentController } from './enrollment.controller.js'
import { EnrollmentService } from './enrollment.service.js'
import { PracticeController } from './practice.controller.js'
import { PracticeService } from './practice.service.js'
import { ThresholdController } from './threshold.controller.js'
import { ThresholdService } from './threshold.service.js'

@Module({
  controllers: [
    PracticeController,
    AssignmentController,
    ThresholdController,
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
