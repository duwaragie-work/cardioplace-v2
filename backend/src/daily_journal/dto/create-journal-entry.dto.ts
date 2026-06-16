import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMaxSize,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidateNested,
  ValidationOptions,
} from 'class-validator'
import { Type } from 'class-transformer'
import {
  JOURNAL_NOTE_MAX_LENGTH,
  JOURNAL_CUSTOM_SYMPTOM_MAX_LENGTH,
  JOURNAL_CUSTOM_SYMPTOMS_MAX_COUNT,
} from '@cardioplace/shared'

function IsMeasuredAtReasonable(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isMeasuredAtReasonable',
      target: (object as { constructor: new (...args: unknown[]) => unknown })
        .constructor,
      propertyName,
      options: {
        message: `${propertyName} must be within the last 30 days and no more than 5 minutes in the future`,
        ...validationOptions,
      },
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false
          const d = new Date(value)
          if (isNaN(d.getTime())) return false
          const now = Date.now()
          const maxFuture = now + 5 * 60 * 1000
          const maxPast = now - 30 * 24 * 60 * 60 * 1000
          return d.getTime() <= maxFuture && d.getTime() >= maxPast
        },
      },
    })
  }
}

export enum MissedMedicationReason {
  FORGOT = 'FORGOT',
  SIDE_EFFECTS = 'SIDE_EFFECTS',
  RAN_OUT = 'RAN_OUT',
  COST = 'COST',
  INTENTIONAL = 'INTENTIONAL',
  OTHER = 'OTHER',
}

/**
 * Per-medication miss detail — submitted when the patient taps "Missed" in
 * the MEDICATION step of CheckIn.tsx and then checks off which medications
 * they skipped. Shape persisted as-is into JournalEntry.missedMedications
 * (JSON column) so the snapshot survives PatientMedication renames.
 *
 * `medicationId` and `drugClass` are optional on the wire so the voice
 * agent (which only knows drug names) can submit a loose shape. The
 * service layer resolves missing fields via Prisma using `drugName` and
 * filters out AS_NEEDED meds before persisting.
 */
export class MissedMedicationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  medicationId?: string

  @IsString()
  @IsNotEmpty()
  drugName!: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  drugClass?: string

  @IsEnum(MissedMedicationReason)
  reason!: MissedMedicationReason

  @IsInt()
  @Min(1)
  @Max(10)
  missedDoses!: number
}

/**
 * Per-medication status snapshot for EVERY answered medication on a reading
 * (taken / missed / scheduledLater) — not just the missed ones. Persisted as-is
 * into JournalEntry.medicationStatuses (JSON) so the readings edit modal +
 * detail view can reconstruct each med's exact answer on reopen. The aggregate
 * medicationTaken + medicationScheduledLater booleans can't disambiguate
 * "med A taken, med B not due yet"; this can.
 *
 * UI-reconstruction only — the rule engine still reads medicationTaken +
 * missedMedications. `medicationId` / `drugClass` are optional so a loose
 * (voice) client can submit drugName alone.
 */
export class MedicationStatusDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  medicationId?: string

  @IsString()
  @IsNotEmpty()
  drugName!: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  drugClass?: string

  @IsIn(['yes', 'no', 'scheduledLater'])
  taken!: 'yes' | 'no' | 'scheduledLater'

  @IsOptional()
  @IsEnum(MissedMedicationReason)
  reason?: MissedMedicationReason

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  missedDoses?: number
}

export class CreateJournalEntryDto {
  @IsNotEmpty({ message: 'measuredAt is required' })
  @IsISO8601({}, { message: 'measuredAt must be a valid ISO 8601 UTC timestamp' })
  @IsMeasuredAtReasonable()
  measuredAt!: string

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(250)
  systolicBP?: number

  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(150)
  diastolicBP?: number

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(220)
  pulse?: number

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(300)
  weight?: number

  @IsOptional()
  @IsIn(['SITTING', 'STANDING', 'LYING'])
  position?: 'SITTING' | 'STANDING' | 'LYING'

  @IsOptional()
  @IsUUID()
  sessionId?: string

  @IsOptional()
  @IsObject({ message: 'measurementConditions must be a JSON object' })
  measurementConditions?: Record<string, unknown>

  @IsOptional()
  @IsBoolean()
  medicationTaken?: boolean

  // Phase/26 silent-literacy — patient flagged ANY medication as "not due yet"
  // on this entry. Distinct from `medicationTaken` so the rule engine knows
  // the gap is intentional rather than a missed dose. Adherence rule
  // (engine/adherence.ts) only fires on `medicationTaken === false`, so a
  // scheduledLater entry with medicationTaken=undefined is silently ignored
  // by the rule pipeline — exactly the desired behaviour.
  @IsOptional()
  @IsBoolean()
  medicationScheduledLater?: boolean

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  missedDoses?: number

  // Per-medication miss detail. Optional — form may submit an empty array /
  // undefined if patient either took all meds or tapped "Missed" without
  // specifying which drug.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MissedMedicationDto)
  missedMedications?: MissedMedicationDto[]

  // Per-medication status snapshot for every answered med (UI reconstruction).
  // Capped well above any realistic active-med count.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => MedicationStatusDto)
  medicationStatuses?: MedicationStatusDto[]

  // Legacy field — v1 clients send freeform symptom strings; we route them
  // to JournalEntry.otherSymptoms. New v2 clients (Flow B) prefer the
  // explicit `otherSymptoms` field below plus the structured booleans.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  symptoms?: string[]

  // ── V2 structured Level-2 symptom triggers (Flow B / phase/15) ─────────
  @IsOptional() @IsBoolean() severeHeadache?: boolean
  @IsOptional() @IsBoolean() visualChanges?: boolean
  @IsOptional() @IsBoolean() alteredMentalStatus?: boolean
  @IsOptional() @IsBoolean() chestPainOrDyspnea?: boolean
  @IsOptional() @IsBoolean() focalNeuroDeficit?: boolean
  @IsOptional() @IsBoolean() severeEpigastricPain?: boolean

  // Pregnancy-specific (only meaningful when PatientProfile.isPregnant)
  @IsOptional() @IsBoolean() newOnsetHeadache?: boolean
  @IsOptional() @IsBoolean() ruqPain?: boolean
  @IsOptional() @IsBoolean() edema?: boolean

  // Cluster 6 (Manisha 5/10/26) — feeds brady-symptomatic, HF decomp,
  // palpitations, and orthostatic rules. Independent of the L2 BP-emergency
  // override set above — these flow to condition-specific rules instead.
  @IsOptional() @IsBoolean() dizziness?: boolean
  @IsOptional() @IsBoolean() syncope?: boolean
  @IsOptional() @IsBoolean() palpitations?: boolean
  @IsOptional() @IsBoolean() legSwelling?: boolean

  // Cluster 7 (Manisha 5/11/26) — Appendix A side-effect + interaction inputs.
  // fatigue + shortnessOfBreath feed β-blocker rules (A.1, A.2 HF/non-HF).
  // dryCough feeds the ACE-inhibitor side-effect (A.4). nsaidUse captures the
  // per-reading "took NSAID recently" checkbox driving A.3 NSAID +
  // antihypertensive interaction warning.
  @IsOptional() @IsBoolean() fatigue?: boolean
  @IsOptional() @IsBoolean() shortnessOfBreath?: boolean
  @IsOptional() @IsBoolean() dryCough?: boolean
  @IsOptional() @IsBoolean() nsaidUse?: boolean

  // Cluster 8 (Manisha 5/18/26, P0) — ACE-angioedema airway emergency.
  // Either flag fires the angioedema rule (Tier 1) for ALL patients.
  @IsOptional() @IsBoolean() faceSwelling?: boolean
  @IsOptional() @IsBoolean() throatTightness?: boolean

  // Patient-typed custom symptoms — one string per chip the patient added in
  // the check-in step 5 / readings edit tag input. Bounded so a runaway client
  // can't store an oversized array or oversized individual entries.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(JOURNAL_CUSTOM_SYMPTOMS_MAX_COUNT)
  @IsString({ each: true })
  @MaxLength(JOURNAL_CUSTOM_SYMPTOM_MAX_LENGTH, { each: true })
  otherSymptoms?: string[]

  @IsOptional()
  @IsString()
  teachBackAnswer?: string

  @IsOptional()
  @IsBoolean()
  teachBackCorrect?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(JOURNAL_NOTE_MAX_LENGTH)
  notes?: string

  @IsOptional()
  @IsString({ message: 'source must be a string' })
  @IsIn(['manual', 'healthkit'], {
    message: 'source must be one of: manual, healthkit',
  })
  source?: 'manual' | 'healthkit'

  @IsOptional()
  @IsObject({ message: 'sourceMetadata must be a JSON object' })
  sourceMetadata?: Record<string, unknown>

  // ── Option D — retake-to-confirm (Manisha 2026-06-12 Q2) ──────────────────
  // The patient app sets ONE of these when resolving the BP-only emergency
  // retake flow (≥180/120, no symptoms). Mutually exclusive in practice.

  // First-of-pair: persist the emergency reading as AWAITING (held — the engine
  // is NOT run) and prompt the patient for a confirmatory second reading. The
  // 202 response carries the new entry id so the app can pass `confirmsEntryId`
  // on the second reading.
  @IsOptional()
  @IsBoolean()
  beginEmergencyConfirmation?: boolean

  // Second-of-pair: this reading confirms/clears the AWAITING first-of-pair
  // whose id is given here. The service marks this entry CONFIRMATORY, releases
  // the first-of-pair's hold, and the engine fires the resolved outcome
  // (ABSOLUTE_EMERGENCY if still ≥180/120, else EMERGENCY_RANGE_CONFIRMED_NORMAL).
  @IsOptional()
  @IsUUID()
  confirmsEntryId?: string

  // Bug 19 (2026-06-17) — the patient explicitly closed this session ("I'm good"
  // buffer commit, or Option D confirmatory). Stamps `sessionClosedAt` on this
  // entry + every prior entry sharing its session, so the active-session prompt
  // never re-offers a session the patient already declared done. Default false
  // for chat-tool / legacy creates.
  @IsOptional()
  @IsBoolean()
  closeSession?: boolean
}
