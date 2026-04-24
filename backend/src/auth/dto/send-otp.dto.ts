import { IsEmail, IsIn, IsNotEmpty, IsOptional } from 'class-validator'

export class SendOtpDto {
  @IsEmail()
  @IsNotEmpty()
  email: string

  /**
   * Caller app context. The admin app sends `'admin'` so the backend can
   * gate on role + reject unknown emails (admin login must NOT auto-create
   * a PATIENT user). Defaults to patient behavior when omitted.
   */
  @IsOptional()
  @IsIn(['admin', 'patient'])
  appContext?: 'admin' | 'patient'
}
