import { IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * Body for `POST /admin/users/:id/permanent-close`. Irreversible tombstone.
 * `confirmDisplayId` must exactly match the target account's DisplayID — an
 * anti-typo gate so an admin can't close the wrong account by fat-finger.
 */
export class PermanentCloseDto {
  @IsString()
  @MaxLength(64)
  confirmDisplayId!: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}
