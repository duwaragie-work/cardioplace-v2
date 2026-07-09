import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AuditFailureTallyService } from './audit/audit-failure-tally.service.js'
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
  ],
  exports: [
    LangSmithService,
    EmbeddingService,
    EncryptionService,
    PatientAccessService,
    AuditFailureTallyService,
  ],
})
export class CommonModule {}
