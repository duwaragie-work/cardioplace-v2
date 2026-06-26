import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { PrismaModule } from '../prisma/prisma.module.js'
import { UsersModule } from '../users/users.module.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { GeolocationService } from './geolocation.service.js'
import { BcryptService } from './bcrypt.service.js'
import { MfaService } from './mfa.service.js'
import { WebAuthnService } from './webauthn.service.js'
import { Public } from './decorators/public.decorator.js'
import { JwtAuthGuard } from './guards/jwt-auth.guard.js'
import { MfaRequiredGuard } from './guards/mfa-required.guard.js'
import { PracticeRequiredGuard } from './guards/practice-required.guard.js'
import { RolesGuard } from './guards/roles.guard.js'
import { JwtStrategy } from './strategies/jwt.strategy.js'

export { Public }

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    ConfigModule,
    // For DisplayIdService at the 4 user-create sites (OAuth, OTP,
    // magic-link, invite-accept). UsersModule does NOT import AuthModule,
    // so this does not create a circular dependency.
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    AuthService,
    BcryptService,
    GeolocationService,
    MfaService,
    WebAuthnService,
    JwtStrategy,
    // GoogleStrategy,   // DISABLED – OTP-only auth
    // AppleStrategy,    // DISABLED – OTP-only auth
    JwtAuthGuard,
    // GoogleAuthGuard,  // DISABLED – OTP-only auth
    // AppleAuthGuard,   // DISABLED – OTP-only auth
    RolesGuard,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    // Force-enrollment gate runs AFTER auth + roles so req.user is populated.
    // Dark until MFA_ENFORCEMENT_ENABLED=true (deploy-then-flip cutover).
    {
      provide: APP_GUARD,
      useClass: MfaRequiredGuard,
    },
    // Practice-selection gate (Manisha 2026-06-12 §1) — after MFA, a multi-
    // practice clinician must pick a practice before any protected route.
    {
      provide: APP_GUARD,
      useClass: PracticeRequiredGuard,
    },
  ],
  controllers: [AuthController],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
