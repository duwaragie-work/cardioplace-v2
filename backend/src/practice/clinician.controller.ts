import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { RolesGuard } from '../auth/guards/roles.guard.js'
import { Roles } from '../auth/decorators/roles.decorator.js'
import { UserRole } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'

/**
 * Flow J3 — global clinician lookup. Powers the AssignmentPanel dropdowns
 * (Primary provider / Backup provider / Medical director). Practice staff
 * are derived from existing PatientProviderAssignment rows
 * (PracticeController.listStaff), but for a NEW patient the practice may
 * have no staff yet. This endpoint returns the whole pool so admins can
 * bootstrap the first assignment.
 */
@Controller('admin/clinicians')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.MEDICAL_DIRECTOR, UserRole.HEALPLACE_OPS)
export class ClinicianController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query('role') role?: string) {
    // The User.roles field is an enum array; we want anyone with PROVIDER
    // or MEDICAL_DIRECTOR (a single user can hold both).
    const filterRoles = role
      ? [role as UserRole]
      : [UserRole.PROVIDER, UserRole.MEDICAL_DIRECTOR]

    const users = await this.prisma.user.findMany({
      where: { roles: { hasSome: filterRoles } },
      select: { id: true, name: true, email: true, roles: true },
      orderBy: { name: 'asc' },
    })

    return {
      statusCode: 200,
      message: 'Clinicians retrieved',
      data: users,
    }
  }
}
