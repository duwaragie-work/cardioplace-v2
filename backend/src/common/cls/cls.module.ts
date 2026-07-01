import { Module } from '@nestjs/common'
import { ClsModule } from 'nestjs-cls'

/**
 * Request-scoped continuation-local storage for PHI access attribution
 * (Humaira N8 / 164.312-T7). The middleware runs after auth has populated
 * `req.user`, capturing the actor + request metadata into CLS so the
 * access-log Prisma extension (behavior lands Thursday) can stamp each PHI
 * read/write with who did it, without threading the actor through every
 * service call.
 *
 * SYSTEM_ACTOR is the fallback for unauthenticated paths (cron jobs, webhooks)
 * where `req.user` is absent — those still write AccessLog rows, just with a
 * null actorId.
 */
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls, req) => {
          const actor = (req as any).user as
            | { id: string; roles: string[] }
            | undefined
          cls.set('actorId', actor?.id ?? null)
          cls.set('actorType', actor ? 'USER' : 'SYSTEM_ACTOR')
          cls.set('ip', req.ip)
          cls.set('userAgent', req.headers['user-agent'])
        },
      },
    }),
  ],
  exports: [ClsModule],
})
export class CardioplaceClsModule {}
