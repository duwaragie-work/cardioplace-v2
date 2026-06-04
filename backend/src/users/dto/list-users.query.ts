import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { UserRole } from '../../generated/prisma/enums.js'

/**
 * Extra synthetic status filter for the admin user list — surfaces the
 * "Invite Pending" bucket (no User row yet, just an open UserInvite) on
 * top of the real AccountStatus values.
 */
export const UserListStatus = {
  ACTIVE: 'ACTIVE',
  BLOCKED: 'BLOCKED',
  SUSPENDED: 'SUSPENDED',
  DEACTIVATED: 'DEACTIVATED',
  INVITE_PENDING: 'INVITE_PENDING',
} as const

export type UserListStatus =
  (typeof UserListStatus)[keyof typeof UserListStatus]

/**
 * Query params for `GET /admin/users`. All filters optional. Practice
 * scoping for COORDINATOR callers is enforced server-side regardless of
 * what the caller passes (defense-in-depth — a coordinator can never
 * widen their scope to another practice).
 */
export class ListUsersQuery {
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole

  @IsOptional()
  @IsString()
  practiceId?: string

  @IsOptional()
  @IsEnum(UserListStatus)
  status?: UserListStatus

  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number
}
