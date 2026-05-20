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
import { AssignmentService } from './assignment.service.js'
import { CreateAssignmentDto } from './dto/create-assignment.dto.js'
import { UpdateAssignmentDto } from './dto/update-assignment.dto.js'

type AuthedReq = Request & { user: { id: string; roles: UserRole[] } }

// Patient ↔ care-team assignment (May 2026 access-scope — see docs/ACCESS_SCOPE.md).
//   • READ — open to all four admin roles. PROVIDER + MED_DIR + OPS see
//     who the primary / backup / medical director are on the patient
//     detail screen.
//   • WRITE — SUPER_ADMIN, MEDICAL_DIRECTOR, HEALPLACE_OPS. PROVIDER
//     excluded (they don't reassign their own care team). MED_DIR is
//     further runtime-scoped by PatientAccessService to practices they
//     head — see assignment.service.ts.
// Method-level @Roles() overrides the controller-level decorator.
@Controller('admin/patients/:userId/assignment')
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.MEDICAL_DIRECTOR,
  UserRole.HEALPLACE_OPS,
  UserRole.PROVIDER,
)
export class AssignmentController {
  constructor(private readonly service: AssignmentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR, UserRole.HEALPLACE_OPS)
  create(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
    @Body() dto: CreateAssignmentDto,
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
  @Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR, UserRole.HEALPLACE_OPS)
  update(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.service.update(
      { id: req.user.id, roles: req.user.roles },
      patientUserId,
      dto,
    )
  }
}
