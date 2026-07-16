import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AccessLogWriter } from './audit/access-log-writer.js'
import { AuditFailureTallyService } from './audit/audit-failure-tally.service.js'
import { NullRedactor, PHI_REDACTOR } from './audit/phi-redactor.js'
import { LangSmithService } from './langsmith.service.js'
import { EmbeddingService } from './embedding.service.js'
import { EncryptionService } from './encryption.service.js'
import { PatientAccessService } from './patient-access.service.js'

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    LangSmithService,
    EmbeddingService,
    EncryptionService,
    PatientAccessService,
    // N7 (2026-07-11) — registers the DROPPED_AUDIT_WRITES tally sink on
    // write-with-retry at boot. Kept in CommonModule (@Global) so PrismaModule
    // (also @Global) is available for injection without an explicit import.
    AuditFailureTallyService,
    // V-17 (2026-07-16) — access-log Pino writer + PHI redactor. Default
    // binding is NullRedactor (drops every payload); V-05's follow-up PR
    // replaces it with a real redactor. See phi-redactor.ts.
    { provide: PHI_REDACTOR, useClass: NullRedactor },
    AccessLogWriter,
  ],
  exports: [
    LangSmithService,
    EmbeddingService,
    EncryptionService,
    PatientAccessService,
    AuditFailureTallyService,
    PHI_REDACTOR,
    AccessLogWriter,
  ],
})
export class CommonModule {}
