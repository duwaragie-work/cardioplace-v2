import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ThrottlerModule } from '@nestjs/throttler'
import { AppController } from './app.controller.js'
import { AppService } from './app.service.js'
import { AuthModule } from './auth/auth.module.js'
import { DailyJournalModule } from './daily_journal/daily_journal.module.js'
import { IntakeModule } from './intake/intake.module.js'
import { PracticeModule } from './practice/practice.module.js'
import { KnowledgebaseModule } from './knowledgebase/knowledgebase.module.js'
import { GeminiModule } from './gemini/gemini.module.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { PrismaService } from './prisma/prisma.service.js'
import { UsersModule } from './users/users.module.js'
import { UsersService } from './users/users.service.js'
import { ChatModule } from './chat/chat.module.js'
import { ContentModule } from './content/content.module.js'
import { ProviderModule } from './provider/provider.module.js'
import { EmailModule } from './email/email.module.js'
import { VoiceModule } from './voice/voice.module.js'
import { CommonModule } from './common/common.module.js'
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),

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

    CommonModule,
    PrismaModule,
    EmailModule,
    AuthModule,
    KnowledgebaseModule,
    GeminiModule,
    UsersModule,
    ChatModule,
    DailyJournalModule,
    IntakeModule,
    PracticeModule,
    ContentModule,
    ProviderModule,
    VoiceModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
