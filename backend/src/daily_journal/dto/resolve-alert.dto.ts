import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'
import {
  ALL_RESOLUTION_ACTIONS,
  type ResolutionAction,
} from '../escalation/resolution-actions.js'

// Phase/7 — DTO for POST /admin/alerts/:id/resolve.
// Validation rule on `resolutionRationale` is tier-aware AND
// action-aware (see AlertResolutionService.resolve). The `@IsOptional()` here
// lets bare-body requests through so the service can return a clear 400 with
// the exact missing-rationale reason.

export class ResolveAlertDto {
  @IsEnum(ALL_RESOLUTION_ACTIONS, {
    message: `resolutionAction must be one of: ${ALL_RESOLUTION_ACTIONS.join(', ')}`,
  })
  resolutionAction!: ResolutionAction

  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'resolutionRationale must be at least 3 characters' })
  @MaxLength(2000)
  resolutionRationale?: string
}
