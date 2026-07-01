import { Module } from '@nestjs/common'
import { ClsModule } from 'nestjs-cls'

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
          cls.set('ip', req?.ip ?? null)
          cls.set('userAgent', req?.headers?.['user-agent'] ?? null)
        },
      },
    }),
  ],
  exports: [ClsModule],
})
export class CardioplaceClsModule {}
