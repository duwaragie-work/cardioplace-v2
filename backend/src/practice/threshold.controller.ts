import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common'
import type { Request } from 'express'
import { ActiveContext } from '../auth/decorators/active-context.decorator.js'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { PatientAccessService } from '../common/patient-access.service.js'
import { UserRole } from '../generated/prisma/enums.js'
import { UpsertThresholdDto } from './dto/upsert-threshold.dto.js'
import { ThresholdService } from './threshold.service.js'

type AuthedReq = Request & {
  user: { id: string; roles: UserRole[]; activePracticeId?: string | null }
}

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
  constructor(
    private readonly service: ThresholdService,
    private readonly access: PatientAccessService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR, UserRole.PROVIDER)
  create(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
    @Body() dto: UpsertThresholdDto,
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    return this.service.create(
      { id: req.user.id, roles: req.user.roles, activePracticeId: req.user.activePracticeId },
      patientUserId,
      dto,
      ctx,
    )
  }

  @Get()
  async findOne(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
  ) {
    await this.access.assertCanAccessPatient(
      { id: req.user.id, roles: req.user.roles, activePracticeId: req.user.activePracticeId },
      patientUserId,
    )
    return this.service.findByPatient(patientUserId)
  }

  @Patch()
  @Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR, UserRole.PROVIDER)
  update(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
    @Body() dto: UpsertThresholdDto,
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    return this.service.update(
      { id: req.user.id, roles: req.user.roles, activePracticeId: req.user.activePracticeId },
      patientUserId,
      dto,
      ctx,
    )
  }

  // THR-033 — clear a patient's personalized threshold (reverts them to the
  // standard table; cascades an enrollment revert when the condition still
  // requires one). Same write-role scope as create/update.
  @Delete()
  @Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR, UserRole.PROVIDER)
  remove(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    return this.service.delete(
      { id: req.user.id, roles: req.user.roles, activePracticeId: req.user.activePracticeId },
      patientUserId,
      ctx,
    )
  }
}
