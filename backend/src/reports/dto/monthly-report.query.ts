import { IsOptional, IsString, Matches } from 'class-validator'

/**
 * Query for `GET /api/v2/reports/monthly` and `.csv`.
 *
 *   practiceId — required for MED_DIR (scoped to their own practice anyway).
 *                Optional for OPS / SUPER; when omitted, the service rolls
 *                up across every practice the caller can see (v1 returns
 *                a per-practice list; cross-practice aggregation is v2).
 *   month      — YYYY-MM in the practice's businessHoursTimezone. Defaults
 *                to the previous calendar month when omitted.
 *   fresh      — '1' bypasses the snapshot cache and recomputes from raw
 *                tables (always recomputes for the current month — the
 *                cache only applies to past months).
 */
export class MonthlyReportQuery {
  @IsOptional()
  @IsString()
  practiceId?: string

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'month must be in YYYY-MM format',
  })
  month?: string

  @IsOptional()
  @IsString()
  fresh?: string
}
