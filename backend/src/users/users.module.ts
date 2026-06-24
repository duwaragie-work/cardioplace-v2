import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { EmailModule } from '../email/email.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { DisplayIdService } from './display-id.service.js'
import { UsersController } from './users.controller.js'
import { UsersService } from './users.service.js'

@Module({
  // PrismaModule is @Global() — listing it for clarity. EmailModule is
  // @Global() too but kept explicit so the dependency surface is
  // self-documenting. ConfigModule for USER_INVITE_TTL_HOURS + BACKEND_URL.
  imports: [PrismaModule, EmailModule, ConfigModule],
  controllers: [UsersController],
  providers: [UsersService, DisplayIdService],
  exports: [UsersService, DisplayIdService],
})
export class UsersModule {}
