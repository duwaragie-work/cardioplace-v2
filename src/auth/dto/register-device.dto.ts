import { IsIn, IsOptional, IsString } from 'class-validator'

export class RegisterDeviceDto {
  @IsString()
  deviceId: string

  @IsOptional()
  @IsIn(['web', 'ios', 'android', 'watchos', 'wearos'])
  platform?: string

  @IsOptional()
  @IsIn(['browser', 'phone', 'tablet', 'watch', 'wearable'])
  deviceType?: string

  @IsOptional()
  @IsString()
  deviceName?: string
}
