import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { UserRole } from '../generated/prisma/enums.js'
import { AssignmentService } from './assignment.service.js'
import { CreateAssignmentDto } from './dto/create-assignment.dto.js'
import { UpdateAssignmentDto } from './dto/update-assignment.dto.js'

// Patient ↔ care-team assignment.
//   • READ — open to all four admin roles. PROVIDER needs to see who the
//     primary / backup / medical director are on the patient detail
//     screen, even though they can't reassign.
//   • WRITE — SUPER_ADMIN, MEDICAL_DIRECTOR, HEALPLACE_OPS. PROVIDER
//     is excluded; they don't reassign their own care team.
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
    @Param('userId') patientUserId: string,
    @Body() dto: CreateAssignmentDto,
  ) {
    return this.service.create(patientUserId, dto)
  }

  @Get()
  findOne(@Param('userId') patientUserId: string) {
    return this.service.findByPatient(patientUserId)
  }

  @Patch()
  @Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR, UserRole.HEALPLACE_OPS)
  update(
    @Param('userId') patientUserId: string,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.service.update(patientUserId, dto)
  }
}
