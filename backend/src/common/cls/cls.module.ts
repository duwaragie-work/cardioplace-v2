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
 * ─── Mount: MIDDLEWARE (was INTERCEPTOR before N-3, 2026-07-14 triage) ───
 *
 * The old interceptor mount runs AFTER guards, so `req.user` (populated by
 * JwtAuthGuard) was available when the interceptor set the actor. That worked
 * for controller code — but `JwtStrategy.validate()` itself does a User read
 * INSIDE the guard phase (phase/28 session kill-switch + status gate,
 * jwt.strategy.ts:99). That read fired the access-log extension with an
 * unset CLS → every authenticated request wrote one AccessLog row with
 * `actorType='SYSTEM_ACTOR', actorId=null, systemActorLabel=null` — burying
 * genuine human PHI access under `system: unknown` noise (Duwaragie's N-3).
 *
 * Fix: mount as MIDDLEWARE so a fresh CLS context exists BEFORE guards run.
 * The middleware stamps request-only metadata (ip, userAgent, runId) plus a
 * default "no actor yet" placeholder. `JwtStrategy.validate()` then overwrites
 * `actorId` / `actorType` / `activePracticeId` from the JWT payload as its
 * FIRST step, before the User.findUnique — the same row that used to be
 * `system: unknown` now attributes to the signed-in user.
 *
 * `req.user` is intentionally NOT consulted here; JwtStrategy is the single
 * write path for actor identity, so no post-guard sync is needed.
 *
 * SYSTEM_ACTOR remains the correct fallback for paths that never hit the auth
 * pipeline: cron writes (already covered by runAsCronActor), startup seeds/
 * migrations through PrismaService, and unauthenticated handlers (health/
 * metrics, sign-in POSTs, forgot-password).
 */
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls, req) => {
          // Defaults — will be overwritten by JwtStrategy.validate() for
          // authenticated requests. Paths that skip JwtAuthGuard (health,
          // sign-in, unauth pages) keep these values, which correctly log as
          // SYSTEM_ACTOR/null (the write is by the process, not a human).
          cls.set('actorId', null)
          cls.set('actorType', 'SYSTEM_ACTOR')
          // HTTP requests never carry a cron label — only runAsCronActor sets
          // this. Explicit null here so a bad merge can't reuse a previous
          // request's label.
          cls.set('systemActorLabel', null)
          cls.set('activePracticeId', null)
          // N2 (2026-07-07) — per-request correlation id. AccessLog rows
          // written during this request share the same runId; distinct HTTP
          // requests get distinct ids. Symmetric with the cron path in
          // runAsCronActor so the exception-report cron (N7) can group audit
          // rows by runId regardless of whether the actor was a user or a
          // system principal.
          cls.set('runId', randomUUID())
          // ip / userAgent come from the raw request; both are set before any
          // guard runs, so grabbing them here is safe. `req.ip` respects
          // trust-proxy config (main.ts sets `trust proxy`).
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
