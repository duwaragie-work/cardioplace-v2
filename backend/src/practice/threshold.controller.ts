import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common'
import type { Request } from 'express'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { UserRole } from '../generated/prisma/enums.js'
import { UpsertThresholdDto } from './dto/upsert-threshold.dto.js'
import { ThresholdService } from './threshold.service.js'

type AuthedReq = Request & { user: { id: string } }

// Thresholds are a clinical directive — setting them is medical-director /
// super-admin work per CLINICAL_SPEC. PROVIDER is intentionally excluded here
// (they'll read thresholds in phase/8; they won't author them).
@Controller('admin/patients/:userId/threshold')
@Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR)
export class ThresholdController {
  constructor(private readonly service: ThresholdService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
    @Body() dto: UpsertThresholdDto,
  ) {
    return this.service.create(req.user.id, patientUserId, dto)
  }

  @Get()
  findOne(@Param('userId') patientUserId: string) {
    return this.service.findByPatient(patientUserId)
  }

  @Patch()
  update(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
    @Body() dto: UpsertThresholdDto,
  ) {
    return this.service.update(req.user.id, patientUserId, dto)
  }
}
