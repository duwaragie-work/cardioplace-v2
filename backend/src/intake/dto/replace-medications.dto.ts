import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, ValidateNested } from 'class-validator'
import { IntakeMedicationItemDto } from './intake-medications.dto.js'

/**
 * PUT /me/medications — replace the patient's current medication list.
 *
 * Differs from `IntakeMedicationsDto` only in allowing an empty array, so a
 * patient can clear their list by submitting `{ medications: [] }`. Max size
 * matches the practical ceiling already enforced upstream in the intake
 * wizard.
 */
export class ReplaceMedicationsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => IntakeMedicationItemDto)
  medications!: IntakeMedicationItemDto[]
}
