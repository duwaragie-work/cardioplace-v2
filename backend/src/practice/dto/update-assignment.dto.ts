import { IsOptional, IsString } from 'class-validator'

export class UpdateAssignmentDto {
  @IsOptional()
  @IsString()
  practiceId?: string

  @IsOptional()
  @IsString()
  primaryProviderId?: string

  @IsOptional()
  @IsString()
  backupProviderId?: string

  @IsOptional()
  @IsString()
  medicalDirectorId?: string
}
