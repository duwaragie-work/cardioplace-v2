import { IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator'
import { ReviewOutcome, ReviewType } from '../../generated/prisma/enums.js'

export class SubmitReviewDto {
  @IsEnum(ReviewType)
  reviewType: ReviewType

  @IsEnum(ReviewOutcome)
  outcome: ReviewOutcome

  /** Required when outcome = REJECTED */
  @ValidateIf((o: SubmitReviewDto) => o.outcome === ReviewOutcome.REJECTED)
  @IsString()
  @MaxLength(2000)
  notes?: string
}
