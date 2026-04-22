import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { VoiceGateway } from './voice.gateway.js'
import { VoiceService } from './voice.service.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { ChatModule } from '../chat/chat.module.js'
import { GeminiModule } from '../gemini/gemini.module.js'
import { DailyJournalModule } from '../daily_journal/daily_journal.module.js'

@Module({
  imports: [
    PrismaModule,
    ChatModule,
    DailyJournalModule,
    GeminiModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  providers: [VoiceGateway, VoiceService],
})
export class VoiceModule {}
