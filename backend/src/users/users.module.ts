import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { EmailModule } from '../email/email.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { AccountLifecycleService } from './account-lifecycle.service.js'
import { DisplayIdService } from './display-id.service.js'
import { UsersController } from './users.controller.js'
import { UsersService } from './users.service.js'

@Module({
  // PrismaModule is @Global() — listing it for clarity. EmailModule is
  // @Global() too but kept explicit so the dependency surface is
  // self-documenting. ConfigModule for USER_INVITE_TTL_HOURS + BACKEND_URL.
  // JwtModule (same secret as AuthModule) lets AccountLifecycleService sign +
  // verify the 1-hour patient self-close email token.
  imports: [
    PrismaModule,
    EmailModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [UsersController],
  providers: [UsersService, DisplayIdService, AccountLifecycleService],
  exports: [UsersService, DisplayIdService, AccountLifecycleService],
})
export class UsersModule {}
