import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

/**
 * Query for `GET /api/admin/reports/adherence` (+ `.csv`, `.pdf`).
 *
 *   practiceId — required for MED_DIR (scoped to their practice anyway).
 *                Optional for OPS / SUPER; when omitted and exactly one
 *                practice is accessible, the controller picks it.
 *   days       — rolling look-back length. Defaults to 90 (ADHERENCE_RULES
 *                .windowDays) when omitted. Bounded 1..365 so a forged value
 *                can't ask for an unbounded scan.
 */
export class AdherenceReportQuery {
  @IsOptional()
  @IsString()
  practiceId?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'days must be an integer' })
  @Min(1, { message: 'days must be at least 1' })
  @Max(365, { message: 'days must be 365 or fewer' })
  days?: number
}
