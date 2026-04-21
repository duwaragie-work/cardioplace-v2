import { IsNotEmpty, IsString } from 'class-validator'

export class CreateAssignmentDto {
  @IsString()
  @IsNotEmpty()
  practiceId!: string

  @IsString()
  @IsNotEmpty()
  primaryProviderId!: string

  @IsString()
  @IsNotEmpty()
  backupProviderId!: string

  @IsString()
  @IsNotEmpty()
  medicalDirectorId!: string
}
