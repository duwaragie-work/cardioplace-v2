import { randomUUID } from 'node:crypto'
import { Module } from '@nestjs/common'
import { ClsModule } from 'nestjs-cls'
import { SystemPrincipalsService } from './system-principals.service.js'

/**
 * Request-scoped continuation-local storage for PHI access attribution
 * (Humaira N8 / 164.312-T7). Captures the actor + request metadata into CLS so
 * the access-log Prisma extension can stamp each PHI read/write with who did
 * it, without threading the actor through every service call.
 *
 * Mounted as an INTERCEPTOR, not middleware. NestJS runs middleware BEFORE
 * guards, so at middleware time `req.user` is still undefined (JwtAuthGuard
 * hasn't run yet) — every request would freeze actorId=null and be mis-logged
 * as SYSTEM_ACTOR even for signed-in users (the IP/UA come through because
 * they're on the raw req, but the actor doesn't). Interceptors run AFTER
 * guards, so `req.user` is populated when `setup` reads it. middleware and
 * interceptor are mutually exclusive mount points — only the interceptor is
 * configured here.
 *
 * SYSTEM_ACTOR remains the correct fallback for paths that never hit the auth
 * pipeline: cron writes (until Friday's cron-actor work), startup seeds/
 * migrations through PrismaService, and unauthenticated handlers (health/
 * metrics).
 */
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      interceptor: {
        mount: true,
        setup: (cls, context) => {
          const req = context.switchToHttp().getRequest()
          const actor = req?.user as { id: string; roles?: string[] } | undefined
          cls.set('actorId', actor?.id ?? null)
          cls.set('actorType', actor ? 'USER' : 'SYSTEM_ACTOR')
          // HTTP requests never carry a cron label — a real actor (or an
          // unauthenticated request) is not a background process. Only
          // runAsCronActor sets this. Left null here explicitly.
          cls.set('systemActorLabel', null)
          // N2 (2026-07-07) — per-request correlation id. AccessLog rows written
          // during this request share the same runId; distinct HTTP requests get
          // distinct ids. Symmetric with the cron path in runAsCronActor so the
          // exception-report cron (N7) can group audit rows by runId regardless
          // of whether the actor was a user or a system principal.
          cls.set('runId', randomUUID())
          cls.set('ip', req?.ip ?? null)
          cls.set('userAgent', req?.headers?.['user-agent'] ?? null)
        },
      },
    }),
  ],
  providers: [SystemPrincipalsService],
  exports: [ClsModule, SystemPrincipalsService],
})
export class CardioplaceClsModule {}
