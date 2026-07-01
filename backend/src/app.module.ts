import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ThrottlerModule } from '@nestjs/throttler'
import { AppController } from './app.controller.js'
import { AppService } from './app.service.js'
import { AuthModule } from './auth/auth.module.js'
import { DailyJournalModule } from './daily_journal/daily_journal.module.js'
import { CronsModule } from './crons/crons.module.js'
import { IntakeModule } from './intake/intake.module.js'
import { PracticeModule } from './practice/practice.module.js'
import { ReportsModule } from './reports/reports.module.js'
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
import { OcrModule } from './ocr/ocr.module.js'
import { DrugEnrichmentModule } from './drug-enrichment/drug-enrichment.module.js'
import { CaregiverModule } from './caregiver/caregiver.module.js'
import { SmsModule } from './sms/sms.module.js'
import { SupportModule } from './support/support.module.js'
import { TestControlModule } from './test-control/test-control.module.js'

// Dev-only test-control endpoints (Playwright cron + escalation drivers).
// The TestControlController rejects every request with 403 unless:
//   1. NODE_ENV !== 'production'
//   2. ENABLE_TEST_CONTROL=true
//   3. (optional) X-Test-Control-Secret matches TEST_CONTROL_SECRET
// We mount the module unconditionally because the env-var check at top-level
// of this file evaluates before dotenv loads — the controller-level guard is
// the source of truth, this is defense in depth.
const TEST_CONTROL_MODULES = [TestControlModule]

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
    ReportsModule,
    CronsModule,
    ContentModule,
    ProviderModule,
    VoiceModule,
    OcrModule,
    DrugEnrichmentModule,
    CaregiverModule,
    SmsModule,
    SupportModule,
    ...TEST_CONTROL_MODULES,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
