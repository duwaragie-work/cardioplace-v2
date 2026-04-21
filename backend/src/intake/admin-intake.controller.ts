import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common'
import type { Request } from 'express'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { UserRole } from '../generated/prisma/enums.js'
import { IntakeService } from './intake.service.js'
import {
  CorrectProfileDto,
  VerifyProfileDto,
} from './dto/correct-profile.dto.js'
import { VerifyMedicationDto } from './dto/verify-medication.dto.js'

type AuthedReq = Request & { user: { id: string } }

@Controller('admin')
@Roles(UserRole.SUPER_ADMIN, UserRole.PROVIDER, UserRole.MEDICAL_DIRECTOR)
export class AdminIntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Post('users/:id/verify-profile')
  @HttpCode(HttpStatus.OK)
  verifyProfile(
    @Req() req: AuthedReq,
    @Param('id') patientUserId: string,
    @Body() dto: VerifyProfileDto,
  ) {
    return this.intake.verifyProfile(req.user.id, patientUserId, dto)
  }

  @Post('users/:id/correct-profile')
  @HttpCode(HttpStatus.OK)
  correctProfile(
    @Req() req: AuthedReq,
    @Param('id') patientUserId: string,
    @Body() dto: CorrectProfileDto,
  ) {
    return this.intake.correctProfile(req.user.id, patientUserId, dto)
  }

  @Post('medications/:id/verify')
  @HttpCode(HttpStatus.OK)
  verifyMedication(
    @Req() req: AuthedReq,
    @Param('id') medicationId: string,
    @Body() dto: VerifyMedicationDto,
  ) {
    return this.intake.verifyMedication(req.user.id, medicationId, dto)
  }

  @Get('users/:id/verification-logs')
  listVerificationLogs(@Param('id') patientUserId: string) {
    return this.intake.listVerificationLogs(patientUserId)
  }
}
