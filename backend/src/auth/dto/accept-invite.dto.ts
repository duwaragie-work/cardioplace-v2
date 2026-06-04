import { IsOptional, IsString } from 'class-validator'

/**
 * Body for `POST /v2/auth/invite/:token/accept`. Mirrors the magic-link
 * verify shape — no real payload required (the token in the URL carries
 * everything), but optional device fields are honored so the client can
 * upgrade its session in the same call.
 */
export class AcceptInviteDto {
  @IsOptional()
  @IsString()
  deviceId?: string
}
