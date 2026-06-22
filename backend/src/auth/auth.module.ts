import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { PrismaModule } from '../prisma/prisma.module.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { GeolocationService } from './geolocation.service.js'
import { BcryptService } from './bcrypt.service.js'
import { MfaService } from './mfa.service.js'
import { WebAuthnService } from './webauthn.service.js'
import { Public } from './decorators/public.decorator.js'
import { JwtAuthGuard } from './guards/jwt-auth.guard.js'
import { MfaRequiredGuard } from './guards/mfa-required.guard.js'
import { RolesGuard } from './guards/roles.guard.js'
import { JwtStrategy } from './strategies/jwt.strategy.js'

export { Public }

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    ConfigModule,
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
  ],
  controllers: [AuthController],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
