import { IsOptional, IsString } from 'class-validator'

export class VerifyOtpDto {
  @IsString()
  email: string

  @IsString()
  otp: string

  @IsOptional()
  @IsString()
  deviceId?: string
}
