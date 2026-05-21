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
import { PatientAccessService } from '../common/patient-access.service.js'
import { UserRole } from '../generated/prisma/enums.js'
import { EnrollmentService } from './enrollment.service.js'

type AuthedReq = Request & { user: { id: string; roles: UserRole[] } }

// May 2026 access-scope decision (docs/ACCESS_SCOPE.md):
//   • Complete-onboarding is a clinical readiness call. PROVIDER added so
//     they can enroll their own assigned patients; HEALPLACE_OPS removed
//     (they handle practice ↔ patient assignment, not clinical readiness).
//   • GET /enrollment-check stays open to the same role set so the admin UI
//     can render the 4-piece checklist regardless of which role is viewing.
@Controller('admin/patients/:userId')
@Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR, UserRole.PROVIDER)
export class EnrollmentController {
  constructor(
    private readonly service: EnrollmentService,
    private readonly access: PatientAccessService,
  ) {}

  @Post('complete-enrollment')
  @HttpCode(HttpStatus.OK)
  complete(@Req() req: AuthedReq, @Param('userId') patientUserId: string) {
    return this.service.completeEnrollment(
      { id: req.user.id, roles: req.user.roles },
      patientUserId,
    )
  }

  @Get('enrollment-check')
  async check(
    @Req() req: AuthedReq,
    @Param('userId') patientUserId: string,
  ) {
    await this.access.assertCanAccessPatient(
      { id: req.user.id, roles: req.user.roles },
      patientUserId,
    )
    return this.service.check(patientUserId)
  }
}
