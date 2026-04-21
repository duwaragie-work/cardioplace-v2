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

@Controller('admin/patients/:userId/assignment')
@Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR, UserRole.HEALPLACE_OPS)
export class AssignmentController {
  constructor(private readonly service: AssignmentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
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
  update(
    @Param('userId') patientUserId: string,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.service.update(patientUserId, dto)
  }
}
