import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AppController } from './app.controller.js'
import { AppService } from './app.service.js'
import { KnowledgebaseModule } from './knowledgebase/knowledgebase.module.js'
import { MistralModule } from './mistral/mistral.module.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { PrismaService } from './prisma/prisma.service.js'
import { UsersController } from './users/users.controller.js'
import { UsersModule } from './users/users.module.js'
import { UsersService } from './users/users.service.js'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    KnowledgebaseModule,
    MistralModule,
    UsersModule,
  ],
  controllers: [AppController, UsersController],
  providers: [AppService, PrismaService, UsersService],
})
export class AppModule {}
