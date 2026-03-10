import { IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * Optional body for POST /v2/auth/guest.
 * deviceId can be sent here or via header x-device-id (header takes precedence in controller).
 */
export class GuestLoginDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceId?: string
}
