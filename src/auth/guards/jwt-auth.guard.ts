import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthGuard } from '@nestjs/passport'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js'

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super()
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    // Attach the isPublic flag to the request so handleRequest can read it
    const request = context.switchToHttp().getRequest()
    request.isPublic = isPublic

    return super.canActivate(context)
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    const request = context.switchToHttp().getRequest()

    // If the route is public, return the user if the token was valid, otherwise return null
    if (request.isPublic) {
      return user || null
    }

    // Standard behavior for protected routes
    if (err || !user) {
      throw err || new UnauthorizedException()
    }
    return user
  }
}
