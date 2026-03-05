import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ThrottlerModule } from '@nestjs/throttler'
import { AppController } from './app.controller.js'
import { AppService } from './app.service.js'
import { AuthModule } from './auth/auth.module.js'
import { KnowledgebaseModule } from './knowledgebase/knowledgebase.module.js'
import { MistralModule } from './mistral/mistral.module.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { PrismaService } from './prisma/prisma.service.js'
import { UsersModule } from './users/users.module.js'
import { UsersService } from './users/users.service.js'
import { ChatModule } from './chat/chat.module.js'
import { DailyJournalModule } from './daily_journal/daily_journal.module.js'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Rate limiting
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000, 
        limit: 20,   
      },
      {
        name: 'otp',
        ttl: 60_000, 
        limit: 5,
      },
    ]),

    PrismaModule,
    AuthModule,
    KnowledgebaseModule,
    MistralModule,
    UsersModule,
    ChatModule,
    DailyJournalModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
