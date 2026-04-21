import { Module } from '@nestjs/common'
import { GapAlertService } from './gap-alert.service.js'
import { MonthlyReaskService } from './monthly-reask.service.js'

@Module({
  providers: [GapAlertService, MonthlyReaskService],
  exports: [GapAlertService, MonthlyReaskService],
})
export class CronsModule {}
