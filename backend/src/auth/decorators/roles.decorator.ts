import { SetMetadata } from '@nestjs/common'
import { UserRole } from '../../generated/prisma/enums.js'

export const ROLES_KEY = 'roles'

/**
 * Restrict a route to specific user roles.
 *
 * @example
 * @Roles(UserRole.SUPER_ADMIN, UserRole.PROVIDER)
 * @Get('admin/users')
 * listUsers() { ... }
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles)
