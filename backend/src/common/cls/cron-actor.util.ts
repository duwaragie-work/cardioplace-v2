import type { ClsService } from 'nestjs-cls'
import { resolveCronActorId } from './system-principals.js'

/**
 * Cron actor attribution (Humaira N8 / 164.312-T7, HIPAA §164.312(b)).
 *
 * A `@Cron()` handler runs outside any HTTP request, so the CLS interceptor
 * never fires. This helper opens a fresh CLS context for the cron body and:
 *   • stamps a stable `systemActorLabel` (e.g. `'cron-gap-alert'`) so a
 *     compliance query can filter to a single process, and
 *   • (2026-07-03) resolves a real system-principal `actorId` from the label,
 *     so the write attributes to a joinable User row instead of null.
 *
 * `actorType` stays `'SYSTEM_ACTOR'` — a cron is not a human, even though it now
 * carries an actorId. The access-log extension reads `actorType` from CLS (not
 * from "is actorId set"), so a cron write keeps SYSTEM_ACTOR + its label while
 * gaining the principal id. `ip`/`userAgent` stay null.
 *
 * `resolveCronActorId` is a synchronous read of the boot-warmed registry
 * (SystemPrincipalsService). If cold or the label is unmapped it returns null —
 * identical to the pre-2026-07-03 behaviour, so nothing breaks.
 *
 * Wrap the body of each `@Cron()` method:
 *
 *   @Cron('...')
 *   async scheduledRun() {
 *     return runAsCronActor(this.cls, 'cron-gap-alert', () => this.runScan())
 *   }
 */
export async function runAsCronActor<T>(
  cls: ClsService,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  return cls.run(async () => {
    cls.set('actorId', resolveCronActorId(label))
    cls.set('actorType', 'SYSTEM_ACTOR')
    cls.set('systemActorLabel', label)
    cls.set('ip', null)
    cls.set('userAgent', null)
    return fn()
  })
}
