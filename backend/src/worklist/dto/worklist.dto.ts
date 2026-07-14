import { Type } from 'class-transformer'
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'
import {
  AuditExceptionDetectorId,
  AuditExceptionSeverity,
  AuditExceptionStatus,
  SecurityIncidentSeverity,
  SecurityIncidentStatus,
} from '../../generated/prisma/enums.js'

/** Worklist read filters — the L3 reviewer queue over N7's AuditException rows. */
export class ListExceptionsQuery {
  @IsOptional() @IsEnum(AuditExceptionStatus) status?: AuditExceptionStatus
  @IsOptional() @IsEnum(AuditExceptionSeverity) severity?: AuditExceptionSeverity
  @IsOptional()
  @IsEnum(AuditExceptionDetectorId)
  detectorId?: AuditExceptionDetectorId
  @IsOptional() @IsString() practiceContext?: string
  @IsOptional() @IsISO8601() from?: string
  @IsOptional() @IsISO8601() to?: string

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number
}

/** Mark-benign requires a reason (recorded for the §164.312(b) trail). */
export class MarkBenignDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string
}

/** Escalate seeds a SecurityIncident. Title/severity are optional — they
 *  default from the exception when omitted. */
export class EscalateDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) title?: string
  @IsOptional()
  @IsEnum(SecurityIncidentSeverity)
  severity?: SecurityIncidentSeverity
  @IsOptional() @IsString() @MaxLength(2000) notes?: string
}

/** Incident worklist filters. */
export class ListIncidentsQuery {
  @IsOptional() @IsEnum(SecurityIncidentStatus) status?: SecurityIncidentStatus
  @IsOptional()
  @IsEnum(SecurityIncidentSeverity)
  severity?: SecurityIncidentSeverity
  @IsOptional() @IsString() practiceContext?: string
  @IsOptional() @IsString() assignedToOpsId?: string
  @IsOptional() @IsISO8601() from?: string
  @IsOptional() @IsISO8601() to?: string

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number
}

/** Assign an incident — omit to self-assign to the acting reviewer. */
export class AssignIncidentDto {
  @IsOptional() @IsString() assignToOpsId?: string
}

export class IncidentNoteDto {
  @IsString() @MinLength(1) @MaxLength(2000) note!: string
}

export class ResolveIncidentDto {
  @IsString() @MinLength(3) @MaxLength(2000) resolutionNotes!: string
}
