import { IsInt, Max, Min } from 'class-validator'

export class RateContentDto {
  @IsInt()
  @Min(1)
  @Max(5)
  ratingValue: number
}
