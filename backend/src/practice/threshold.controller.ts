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

// Thresholds are a clinical directive per CLINICAL_SPEC.
//   • READ — open to all four admin roles (PROVIDER + HEALPLACE_OPS need
//     to see the configured target on the patient detail screen, even
//     though they can't change it).
//   • WRITE — MEDICAL_DIRECTOR + SUPER_ADMIN only. PROVIDER/OPS cannot
//     author thresholds; they'd be making a clinical decision they're
//     not authorized for.
// Method-level @Roles() overrides the controller-level decorator.
@Controller('admin/patients/:userId/threshold')
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.MEDICAL_DIRECTOR,
  UserRole.PROVIDER,
  UserRole.HEALPLACE_OPS,
)
export class ThresholdController {
  constructor(private readonly service: ThresholdService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR)
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
  @Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR)
  update(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
    @Body() dto: UpsertThresholdDto,
  ) {
    return this.service.update(req.user.id, patientUserId, dto)
  }
}
