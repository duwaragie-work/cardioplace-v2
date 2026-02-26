import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'isPublic'

/**
 * Mark a route as public — the global JwtAuthGuard will skip JWT verification.
 * Guest users (no account) can access routes decorated with @Public().
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
