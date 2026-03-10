import { IsBoolean } from 'class-validator'

export class UpdateNotificationStatusDto {
  @IsBoolean()
  watched!: boolean
}

