import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator'

export class UpdateDocumentDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[]

  @IsOptional()
  @IsBoolean()
  status?: boolean
}
