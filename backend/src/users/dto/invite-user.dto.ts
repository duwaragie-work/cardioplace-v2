import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'
import { UserRole } from '../../generated/prisma/enums.js'

/**
 * Payload for `POST /admin/users/invite`. Practice scoping is validated
 * at the service layer (different rules per caller role) — the DTO only
 * does shape/type validation.
 */
export class InviteUserDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string

  @IsEnum(UserRole)
  role!: UserRole

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  practiceId?: string
}
