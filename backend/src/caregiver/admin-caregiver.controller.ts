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
import { Roles } from '../auth/decorators/roles.decorator.js'
import { PatientAccessService } from '../common/patient-access.service.js'
import { UserRole } from '../generated/prisma/enums.js'
import { CaregiverService } from './caregiver.service.js'
import { CreateCaregiverDto } from './dto/create-caregiver.dto.js'
import { UpdateCaregiverDto } from './dto/update-caregiver.dto.js'

type AuthedReq = Request & {
  user: { id: string; roles: UserRole[]; activePracticeId?: string | null }
}

// Admin-scoped caregiver management for the patient-detail screen.
//   • READ — all four admin roles (HEALPLACE_OPS can view PHI-sharing config).
//   • WRITE — SUPER_ADMIN, PROVIDER, MEDICAL_DIRECTOR (mirrors care-team /
//     verification permission; HEALPLACE_OPS excluded from clinical config).
@Controller('admin/patients/:patientId/caregivers')
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.PROVIDER,
  UserRole.MEDICAL_DIRECTOR,
  UserRole.HEALPLACE_OPS,
)
export class AdminCaregiverController {
  constructor(
    private readonly caregiver: CaregiverService,
    private readonly access: PatientAccessService,
  ) {}

  @Get()
  async list(@Req() req: AuthedReq, @Param('patientId') patientId: string) {
    await this.access.assertCanAccessPatient(
      { id: req.user.id, roles: req.user.roles, activePracticeId: req.user.activePracticeId },
      patientId,
    )
    return this.caregiver.list(patientId)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SUPER_ADMIN, UserRole.PROVIDER, UserRole.MEDICAL_DIRECTOR)
  async create(
    @Req() req: AuthedReq,
    @Param('patientId') patientId: string,
    @Body() dto: CreateCaregiverDto,
  ) {
    await this.access.assertCanAccessPatient(
      { id: req.user.id, roles: req.user.roles, activePracticeId: req.user.activePracticeId },
      patientId,
    )
    return this.caregiver.create(patientId, req.user.id, 'ADMIN', dto)
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.PROVIDER, UserRole.MEDICAL_DIRECTOR)
  async update(
    @Req() req: AuthedReq,
    @Param('patientId') patientId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCaregiverDto,
  ) {
    await this.access.assertCanAccessPatient(
      { id: req.user.id, roles: req.user.roles, activePracticeId: req.user.activePracticeId },
      patientId,
    )
    return this.caregiver.update(patientId, id, req.user.id, 'ADMIN', dto)
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.PROVIDER, UserRole.MEDICAL_DIRECTOR)
  async remove(
    @Req() req: AuthedReq,
    @Param('patientId') patientId: string,
    @Param('id') id: string,
  ) {
    await this.access.assertCanAccessPatient(
      { id: req.user.id, roles: req.user.roles, activePracticeId: req.user.activePracticeId },
      patientId,
    )
    return this.caregiver.remove(patientId, id, req.user.id, 'ADMIN')
  }
}
