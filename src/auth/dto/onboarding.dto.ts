import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class OnboardingDto {
  @IsString()
  name: string

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  age?: number
}
