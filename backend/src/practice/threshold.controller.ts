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

type AuthedReq = Request & { user: { id: string; roles: UserRole[] } }

// Thresholds are a clinical directive per CLINICAL_SPEC.
//   • READ — open to all four admin roles (HEALPLACE_OPS sees the configured
//     target read-only on the patient detail screen).
//   • WRITE — SUPER_ADMIN, MEDICAL_DIRECTOR, PROVIDER (May 2026 scope
//     decision — see docs/ACCESS_SCOPE.md). PROVIDER previously read-only;
//     now writes on their assigned patients. HEALPLACE_OPS still excluded
//     from writes (clinical decision they're not authorized for).
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
  @Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR, UserRole.PROVIDER)
  create(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
    @Body() dto: UpsertThresholdDto,
  ) {
    return this.service.create(
      { id: req.user.id, roles: req.user.roles },
      patientUserId,
      dto,
    )
  }

  @Get()
  findOne(@Param('userId') patientUserId: string) {
    return this.service.findByPatient(patientUserId)
  }

  @Patch()
  @Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR, UserRole.PROVIDER)
  update(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
    @Body() dto: UpsertThresholdDto,
  ) {
    return this.service.update(
      { id: req.user.id, roles: req.user.roles },
      patientUserId,
      dto,
    )
  }
}
