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
import { CreatePracticeDto } from './dto/create-practice.dto.js'
import { UpdatePracticeDto } from './dto/update-practice.dto.js'
import { PracticeService } from './practice.service.js'

type AuthedReq = Request & { user: { id: string; roles: UserRole[] } }

// Practices (May 2026 access-scope decision — see docs/ACCESS_SCOPE.md):
//   • READ — open to all four admin roles. PROVIDER and MED_DIR still need
//     practice names to populate dropdowns / labels even though they can't
//     create or edit them.
//   • WRITE — SUPER_ADMIN, HEALPLACE_OPS only. Practice CRUD is an
//     operational/admin function. MED_DIR was removed (their clinical
//     authority is per-patient inside their practice, not over practice
//     metadata). PROVIDER stays excluded.
// Method-level @Roles() overrides the controller-level decorator.
@Controller('admin/practices')
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.MEDICAL_DIRECTOR,
  UserRole.HEALPLACE_OPS,
  UserRole.PROVIDER,
)
export class PracticeController {
  constructor(private readonly service: PracticeService) {}

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

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HEALPLACE_OPS)
  update(@Param('id') id: string, @Body() dto: UpdatePracticeDto) {
    return this.service.update(id, dto)
  }
}
