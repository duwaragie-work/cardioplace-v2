import { IsNotEmpty, IsString } from 'class-validator'

export class ConsentDto {
  /**
   * Terms + Privacy Policy version the patient agreed to (sourced from
   * @cardioplace/shared POLICY_VERSION). Recorded as a `policy_acknowledged`
   * event on the AuthLog audit trail.
   */
  @IsString()
  @IsNotEmpty()
  policyVersion: string
}
