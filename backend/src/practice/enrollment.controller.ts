import {
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
import { EnrollmentService } from './enrollment.service.js'

type AuthedReq = Request & { user: { id: string } }

@Controller('admin/patients/:userId')
@Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR, UserRole.HEALPLACE_OPS)
export class EnrollmentController {
  constructor(private readonly service: EnrollmentService) {}

  @Post('complete-onboarding')
  @HttpCode(HttpStatus.OK)
  complete(@Req() req: AuthedReq, @Param('userId') patientUserId: string) {
    return this.service.completeOnboarding(req.user.id, patientUserId)
  }

  @Get('enrollment-check')
  check(@Param('userId') patientUserId: string) {
    return this.service.check(patientUserId)
  }
}
