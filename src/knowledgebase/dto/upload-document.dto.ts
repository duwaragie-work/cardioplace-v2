import { IsArray, IsOptional, IsString, IsUrl } from 'class-validator'

export class UploadDocumentDto {
  @IsOptional()
  @IsString()
  sourceType?: string

  @IsOptional()
  @IsUrl()
  resouceLink?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[]
}
