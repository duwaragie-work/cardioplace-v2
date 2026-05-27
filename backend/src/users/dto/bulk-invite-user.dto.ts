import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator'
import { InviteUserDto } from './invite-user.dto.js'

/**
 * Payload for `POST /admin/users/invite/bulk`. Up to 500 invites per
 * request; validate-all-then-create-all (see UsersService.bulkInvite for
 * the atomicity contract).
 */
export class BulkInviteUserDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => InviteUserDto)
  entries!: InviteUserDto[]
}
