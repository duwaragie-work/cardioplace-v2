import { IsArray, IsBoolean, IsString, IsUUID } from 'class-validator'

export class BulkUpdateNotificationStatusDto {
  @IsArray()
  @IsUUID('4', { each: true })
  ids!: string[]

  @IsBoolean()
  watched!: boolean
}

