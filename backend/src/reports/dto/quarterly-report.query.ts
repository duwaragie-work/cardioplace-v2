import { IsOptional, IsString, Matches } from 'class-validator'

/**
 * Query for `GET /api/admin/reports/quarterly` (+ `.csv`, `.pdf`).
 *
 *   practiceId — required for MED_DIR (scoped to their practice anyway).
 *                Optional for OPS / SUPER; resolved to the single accessible
 *                practice when omitted.
 *   quarter    — "YYYY-Qn" (e.g. 2026-Q2) in the practice timezone. Defaults
 *                to the current calendar quarter when omitted.
 */
export class QuarterlyReportQuery {
  @IsOptional()
  @IsString()
  practiceId?: string

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-Q[1-4]$/, {
    message: 'quarter must be in YYYY-Qn format (e.g. 2026-Q2)',
  })
  quarter?: string
}
