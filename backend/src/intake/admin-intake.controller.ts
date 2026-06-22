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
import { IntakeService } from './intake.service.js'
import {
  CorrectProfileDto,
  VerifyProfileDto,
} from './dto/correct-profile.dto.js'
import { VerifyMedicationDto } from './dto/verify-medication.dto.js'
import {
  AdminAddMedicationDto,
  AdminEditMedicationDto,
} from './dto/admin-medication.dto.js'

type AuthedReq = Request & { user: { id: string; roles: UserRole[] } }

// Admin-scoped intake surface.
//   • READ — open to all four admin roles. HEALPLACE_OPS needs to view
//     profile + medications on the patient detail screen even though they
//     can't verify or correct.
//   • WRITE — SUPER_ADMIN, PROVIDER, MEDICAL_DIRECTOR. HEALPLACE_OPS is
//     excluded from clinical verification per spec.
// Method-level @Roles() overrides controller-level via getAllAndOverride.
@Controller('admin')
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.PROVIDER,
  UserRole.MEDICAL_DIRECTOR,
  UserRole.HEALPLACE_OPS,
)
export class AdminIntakeController {
  constructor(
    private readonly intake: IntakeService,
    private readonly access: PatientAccessService,
  ) {}

  @Post('users/:id/verify-profile')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN, UserRole.PROVIDER, UserRole.MEDICAL_DIRECTOR)
  verifyProfile(
    @Req() req: AuthedReq,
    @Param('id') patientUserId: string,
    @Body() dto: VerifyProfileDto,
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    return this.intake.verifyProfile(
      { id: req.user.id, roles: req.user.roles },
      patientUserId,
      dto,
      ctx,
    )
  }

  @Post('users/:id/correct-profile')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN, UserRole.PROVIDER, UserRole.MEDICAL_DIRECTOR)
  correctProfile(
    @Req() req: AuthedReq,
    @Param('id') patientUserId: string,
    @Body() dto: CorrectProfileDto,
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    return this.intake.correctProfile(
      { id: req.user.id, roles: req.user.roles },
      patientUserId,
      dto,
      ctx,
    )
  }

  @Post('users/:id/reject-profile-field')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN, UserRole.PROVIDER, UserRole.MEDICAL_DIRECTOR)
  rejectProfileField(
    @Req() req: AuthedReq,
    @Param('id') patientUserId: string,
    @Body() dto: { field: string; rationale?: string },
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    return this.intake.rejectProfileField(
      { id: req.user.id, roles: req.user.roles },
      patientUserId,
      dto,
      ctx,
    )
  }

  // Per-field ✓ "Confirm" (IVR-08) — writes an ADMIN_VERIFY audit row for the
  // single field without flipping the whole-profile status.
  @Post('users/:id/confirm-profile-field')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN, UserRole.PROVIDER, UserRole.MEDICAL_DIRECTOR)
  confirmProfileField(
    @Req() req: AuthedReq,
    @Param('id') patientUserId: string,
    @Body() dto: { field: string; rationale?: string },
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    return this.intake.confirmProfileField(
      { id: req.user.id, roles: req.user.roles },
      patientUserId,
      dto,
      ctx,
    )
  }

  // Bulk "Confirm all" (IVR-25) — confirms every supplied field in one call.
  @Post('users/:id/confirm-profile-fields')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN, UserRole.PROVIDER, UserRole.MEDICAL_DIRECTOR)
  confirmProfileFields(
    @Req() req: AuthedReq,
    @Param('id') patientUserId: string,
    @Body() dto: { fields: string[]; rationale?: string },
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    return this.intake.confirmProfileFields(
      { id: req.user.id, roles: req.user.roles },
      patientUserId,
      dto,
      ctx,
    )
  }

  @Post('medications/:id/verify')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN, UserRole.PROVIDER, UserRole.MEDICAL_DIRECTOR)
  verifyMedication(
    @Req() req: AuthedReq,
    @Param('id') medicationId: string,
    @Body() dto: VerifyMedicationDto,
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    return this.intake.verifyMedication(
      { id: req.user.id, roles: req.user.roles },
      medicationId,
      dto,
      ctx,
    )
  }

  // #92 — admin adds a medication on the patient's behalf (clinical roles).
  @Post('users/:id/medications')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SUPER_ADMIN, UserRole.PROVIDER, UserRole.MEDICAL_DIRECTOR)
  adminAddMedication(
    @Req() req: AuthedReq,
    @Param('id') patientUserId: string,
    @Body() dto: AdminAddMedicationDto,
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    return this.intake.adminAddMedication(
      { id: req.user.id, roles: req.user.roles },
      patientUserId,
      dto,
      ctx,
    )
  }

  // #92 — admin edits an existing medication (clinical roles).
  @Patch('medications/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN, UserRole.PROVIDER, UserRole.MEDICAL_DIRECTOR)
  adminEditMedication(
    @Req() req: AuthedReq,
    @Param('id') medicationId: string,
    @Body() dto: AdminEditMedicationDto,
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    return this.intake.adminEditMedication(
      { id: req.user.id, roles: req.user.roles },
      medicationId,
      dto,
      ctx,
    )
  }

  @Get('users/:id/verification-logs')
  async listVerificationLogs(
    @Req() req: AuthedReq,
    @Param('id') patientUserId: string,
  ) {
    await this.access.assertCanAccessPatient(
      { id: req.user.id, roles: req.user.roles },
      patientUserId,
    )
    return this.intake.listVerificationLogs(patientUserId)
  }

  // Admin-scoped reads for the Flow H patient detail screen. Controller-
  // level @Roles() gates "what role can call at all"; assertCanAccessPatient
  // adds the runtime scope check — PROVIDER must be on the patient's panel,
  // MED_DIR must head the patient's practice. OPS/SUPER short-circuit.
  @Get('users/:id/profile')
  async getProfile(
    @Req() req: AuthedReq,
    @Param('id') patientUserId: string,
  ) {
    await this.access.assertCanAccessPatient(
      { id: req.user.id, roles: req.user.roles },
      patientUserId,
    )
    return this.intake.getProfile(patientUserId)
  }

  @Get('users/:id/medications')
  async listMedications(
    @Req() req: AuthedReq,
    @Param('id') patientUserId: string,
  ) {
    await this.access.assertCanAccessPatient(
      { id: req.user.id, roles: req.user.roles },
      patientUserId,
    )
    // includeDiscontinued = true so the medications tab can show the full
    // history (discontinued meds are rendered with a strike-through);
    // includeRejected = true so the reconciliation tab surfaces REJECTED rows
    // with their status badge instead of hiding them (IVR-18).
    return this.intake.listMedications(patientUserId, true, true)
  }
}
