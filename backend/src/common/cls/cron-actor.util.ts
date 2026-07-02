import type { ClsService } from 'nestjs-cls'

/**
 * Cron actor attribution (Humaira N8 / 164.312-T7, HIPAA §164.312(b)).
 *
 * A `@Cron()` handler runs outside any HTTP request, so the CLS interceptor
 * never fires and `actorId` is unset — every PHI write it makes lands in
 * AccessLog as `actorType='SYSTEM_ACTOR', actorId=null`. That answers "a
 * background job did this" but not "WHICH background job". This helper opens a
 * fresh CLS context for the cron body and stamps a stable `systemActorLabel`
 * (e.g. `'cron-gap-alert'`) so a compliance query
 * `WHERE actorType='SYSTEM_ACTOR'` can filter to a single process.
 *
 * `actorId` stays null and `actorType` stays SYSTEM_ACTOR — a cron is not a
 * user. `ip`/`userAgent` are null for the same reason. The label is the only
 * attribution a cron write carries.
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
    cls.set('actorId', null)
    cls.set('actorType', 'SYSTEM_ACTOR')
    cls.set('systemActorLabel', label)
    cls.set('ip', null)
    cls.set('userAgent', null)
    return fn()
  })
}
