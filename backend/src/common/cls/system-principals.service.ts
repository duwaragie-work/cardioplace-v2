import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service.js'
import { warmSystemPrincipals } from './system-principals.js'

/**
 * Warms the system-principal id map once at boot (audit, 2026-07-03) so
 * `runAsCronActor` can resolve a cron's actor id synchronously without a
 * per-tick DB lookup (handoff stop-condition: a cold first tick must not
 * block). Non-fatal: if the rows aren't seeded yet, the resolver returns null
 * and cron writes fall back to the pre-fix SYSTEM_ACTOR/null behaviour.
 */
@Injectable()
export class SystemPrincipalsService implements OnModuleInit {
  private readonly logger = new Logger(SystemPrincipalsService.name)

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await warmSystemPrincipals(this.prisma)
      this.logger.log('System-principal registry warmed')
    } catch (err) {
      // A cold registry is safe (resolver returns null → SYSTEM_ACTOR/null).
      // Never block boot on this.
      this.logger.warn(
        `System-principal registry warm failed (cron actorIds will be null until re-warm): ${
          err instanceof Error ? err.message : err
        }`,
      )
    }
  }
}
