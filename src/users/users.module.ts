import { Module } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { UsersController } from './users.controller.js'
import { UsersService } from './users.service.js'

@Module({
  providers: [UsersService, PrismaService],
  controllers: [UsersController],
})
export class UsersModule {}
