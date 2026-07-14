import { Module } from '@nestjs/common'
import { DailyJournalModule } from '../daily_journal/daily_journal.module.js'
import { AdminReadingsController } from './admin-readings.controller.js'
import { AssignmentController } from './assignment.controller.js'
import { AssignmentService } from './assignment.service.js'
import { ClinicianController } from './clinician.controller.js'
import { CoordinatorController } from './coordinator.controller.js'
import { CoordinatorService } from './coordinator.service.js'
import { EnrollmentController } from './enrollment.controller.js'
import { EnrollmentService } from './enrollment.service.js'
import { MeCareTeamController } from './me-care-team.controller.js'
import { MeThresholdController } from './me-threshold.controller.js'
import { PracticeController } from './practice.controller.js'
import { PracticeService } from './practice.service.js'
import { ThresholdController } from './threshold.controller.js'
import { ThresholdService } from './threshold.service.js'

@Module({
  // DailyJournalModule provides EscalationService — needed by
  // EnrollmentService to catch up alerts that were deferred while the
  // patient was un-enrolled. DailyJournalModule does not depend on
  // PracticeModule, so this is a clean one-way edge with no cycle.
  imports: [DailyJournalModule],
  controllers: [
    PracticeController,
    AdminReadingsController,
    AssignmentController,
    ClinicianController,
    CoordinatorController,
    ThresholdController,
    MeThresholdController,
    MeCareTeamController,
    EnrollmentController,
  ],
  providers: [
    PracticeService,
    AssignmentService,
    CoordinatorService,
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
