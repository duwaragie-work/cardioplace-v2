import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import Strategy from 'passport-apple'

export interface AppleProfile {
  id: string
  name?: { firstName?: string; lastName?: string }
  email?: string
}

@Injectable()
export class AppleStrategy extends PassportStrategy(Strategy, 'apple') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('APPLE_SERVICES_ID', ''),
      teamID: config.get<string>('APPLE_TEAM_ID', ''),
      keyID: config.get<string>('APPLE_KEY_ID', ''),
      privateKeyString: config.get<string>('APPLE_PRIVATE_KEY', ''),
      callbackURL: config.get<string>(
        'APPLE_CALLBACK_URL',
        'http://localhost:3000/api/auth/apple/callback',
      ),
      scope: ['email', 'name'],
      passReqToCallback: false,
    })
  }

  validate(_accessToken: string, _refreshToken: string, profile: AppleProfile) {
    return profile
  }
}
