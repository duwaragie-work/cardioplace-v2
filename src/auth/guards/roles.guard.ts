import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { UserRole } from '../../generated/prisma/enums.js'
import { ROLES_KEY } from '../decorators/roles.decorator.js'

interface JwtUser {
  id: string
  email: string | null
  roles: UserRole[]
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    )

    // No @Roles() decorator → route is open to any authenticated user
    if (!requiredRoles?.length) return true

    const user = context.switchToHttp().getRequest<{ user: JwtUser }>().user

    if (!requiredRoles.some((r) => user.roles.includes(r))) {
      throw new ForbiddenException(
        `Access denied. Required roles: ${requiredRoles.join(', ')}`,
      )
    }

    return true
  }
}
