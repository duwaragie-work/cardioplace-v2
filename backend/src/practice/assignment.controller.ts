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
import { ActiveContext } from '../auth/decorators/active-context.decorator.js'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { PatientAccessService } from '../common/patient-access.service.js'
import { UserRole } from '../generated/prisma/enums.js'
import { AssignmentService } from './assignment.service.js'
import { CreateAssignmentDto } from './dto/create-assignment.dto.js'
import { UpdateAssignmentDto } from './dto/update-assignment.dto.js'

type AuthedReq = Request & {
  user: { id: string; roles: UserRole[]; activePracticeId?: string | null }
}

// Patient ↔ care-team assignment (access-scope — see docs/ACCESS_SCOPE.md).
//   • READ — open to all four admin roles. PROVIDER + MED_DIR + OPS see
//     who the primary / backup / medical director are on the patient
//     detail screen.
//   • WRITE — SUPER_ADMIN, MEDICAL_DIRECTOR, HEALPLACE_OPS. PROVIDER
//     excluded (they don't reassign their own care team). COORDINATOR
//     excluded (2026-07-01 walkback from #116 — care-team assignment is a
//     clinical decision, not front-desk). MED_DIR is further runtime-scoped
//     by PatientAccessService to practices they head — see assignment.service.ts.
// Method-level @Roles() overrides the controller-level decorator.
@Controller('admin/patients/:userId/assignment')
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.MEDICAL_DIRECTOR,
  UserRole.HEALPLACE_OPS,
  UserRole.PROVIDER,
)
export class AssignmentController {
  constructor(
    private readonly service: AssignmentService,
    private readonly access: PatientAccessService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.MEDICAL_DIRECTOR,
    UserRole.HEALPLACE_OPS,
  )
  create(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
    @Body() dto: CreateAssignmentDto,
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
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.MEDICAL_DIRECTOR,
    UserRole.HEALPLACE_OPS,
  )
  update(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
    @Body() dto: UpdateAssignmentDto,
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    return this.service.update(
      { id: req.user.id, roles: req.user.roles, activePracticeId: req.user.activePracticeId },
      patientUserId,
      dto,
      ctx,
    )
  }
}
