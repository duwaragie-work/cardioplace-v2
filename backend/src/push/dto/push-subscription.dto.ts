import {
  IsNotEmpty,
  IsObject,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

class SubscriptionKeysDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  p256dh!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  auth!: string
}

/** POST /v2/push/subscribe — the browser PushSubscription (endpoint + keys). */
export class SubscribeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  endpoint!: string

  @IsObject()
  @ValidateNested()
  @Type(() => SubscriptionKeysDto)
  keys!: SubscriptionKeysDto
}

/** POST /v2/push/unsubscribe — remove one endpoint (logout / permission off). */
export class UnsubscribeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  endpoint!: string
}
