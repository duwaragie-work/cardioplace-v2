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
import { CreatePracticeDto } from './dto/create-practice.dto.js'
import { UpdatePracticeDto } from './dto/update-practice.dto.js'
import { PracticeService } from './practice.service.js'

type AuthedReq = Request & { user: { id: string; roles: UserRole[] } }

// Practices (access-scope decision — see docs/ACCESS_SCOPE.md §8):
//   • READ — open to all four admin roles. PROVIDER and MED_DIR still need
//     practice names to populate dropdowns / labels.
//   • WRITE update / staff-membership (2026-07-01) — SUPER_ADMIN,
//     HEALPLACE_OPS, and MEDICAL_DIRECTOR. MED_DIR is runtime-scoped by
//     PatientAccessService.assertCanManagePractice to practices they head.
//     PROVIDER + COORDINATOR stay excluded from writes.
//   • WRITE create / delete — SUPER_ADMIN, HEALPLACE_OPS only. MED_DIR
//     excluded — org-level lifecycle (spin up / tear down a practice) is
//     not a practice-head power.
// Method-level @Roles() overrides the controller-level decorator.
@Controller('admin/practices')
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.MEDICAL_DIRECTOR,
  UserRole.HEALPLACE_OPS,
  UserRole.PROVIDER,
  // COORDINATOR — read-only view of their own practice (list/detail/staff),
  // scoped via practiceScopeIds. Mutating endpoints re-declare stricter
  // @Roles, so this only grants the GETs.
  UserRole.COORDINATOR,
)
export class PracticeController {
  constructor(
    private readonly service: PracticeService,
    private readonly access: PatientAccessService,
  ) {}

  private actorFrom(req: AuthedReq) {
    return { id: req.user.id, roles: req.user.roles }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SUPER_ADMIN, UserRole.HEALPLACE_OPS)
  create(@Body() dto: CreatePracticeDto) {
    return this.service.create(dto)
  }

  @Get()
  list(@Req() req: AuthedReq) {
    return this.service.list({ id: req.user.id, roles: req.user.roles })
  }

  @Get(':id')
  findOne(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.service.findOne(
      { id: req.user.id, roles: req.user.roles },
      id,
    )
  }

  @Get(':id/staff')
  listStaff(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.service.listStaff(
      { id: req.user.id, roles: req.user.roles },
      id,
    )
  }

  // Config edit — SUPER + OPS + MED_DIR (practice-scoped). MED_DIR may only
  // edit practices they head; enforced by assertCanManagePractice.
  @Patch(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HEALPLACE_OPS,
    UserRole.MEDICAL_DIRECTOR,
  )
  async update(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: UpdatePracticeDto,
  ) {
    await this.access.assertCanManagePractice(this.actorFrom(req), id)
    return this.service.update(id, dto)
  }

  // ─── Explicit practice staff membership ──────────────────────────────────
  // SUPER + OPS (any practice) + MED_DIR (practices they head — runtime
  // scoped). Adds/removes a user from PracticeProvider or
  // PracticeMedicalDirector independent of any patient assignment, so a
  // practice can be bootstrapped before the first patient lands.
  // See docs/ACCESS_SCOPE.md §8.

  @Post(':id/providers/:userId')
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HEALPLACE_OPS,
    UserRole.MEDICAL_DIRECTOR,
  )
  async addProvider(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    await this.access.assertCanManagePractice(this.actorFrom(req), id)
    return this.service.addProvider(id, userId)
  }

  @Delete(':id/providers/:userId')
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HEALPLACE_OPS,
    UserRole.MEDICAL_DIRECTOR,
  )
  async removeProvider(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    await this.access.assertCanManagePractice(this.actorFrom(req), id)
    return this.service.removeProvider(id, userId)
  }

  @Post(':id/medical-directors/:userId')
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HEALPLACE_OPS,
    UserRole.MEDICAL_DIRECTOR,
  )
  async addMedicalDirector(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    await this.access.assertCanManagePractice(this.actorFrom(req), id)
    return this.service.addMedicalDirector(id, userId)
  }

  @Delete(':id/medical-directors/:userId')
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HEALPLACE_OPS,
    UserRole.MEDICAL_DIRECTOR,
  )
  async removeMedicalDirector(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    await this.access.assertCanManagePractice(this.actorFrom(req), id)
    return this.service.removeMedicalDirector(id, userId)
  }
}
