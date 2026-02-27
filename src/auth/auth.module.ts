import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { PrismaModule } from '../prisma/prisma.module.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { BcryptService } from './bcrypt.service.js'
import { Public } from './decorators/public.decorator.js'
import { AppleAuthGuard } from './guards/apple-auth.guard.js'
import { GoogleAuthGuard } from './guards/google-auth.guard.js'
import { JwtAuthGuard } from './guards/jwt-auth.guard.js'
import { RolesGuard } from './guards/roles.guard.js'
import { AppleStrategy } from './strategies/apple.strategy.js'
import { GoogleStrategy } from './strategies/google.strategy.js'
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
    JwtStrategy,
    GoogleStrategy,
    AppleStrategy,
    JwtAuthGuard,
    GoogleAuthGuard,
    AppleAuthGuard,
    RolesGuard,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  controllers: [AuthController],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
