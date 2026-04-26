import { IsIn, IsOptional, IsString } from 'class-validator'

export class VerifyOtpDto {
  @IsString()
  email: string

  @IsString()
  otp: string

  @IsOptional()
  @IsString()
  deviceId?: string

  /** See SendOtpDto.appContext. */
  @IsOptional()
  @IsIn(['admin', 'patient'])
  appContext?: 'admin' | 'patient'
}
