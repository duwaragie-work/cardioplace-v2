import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '../generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

/**
 * Prisma error codes that indicate a stale or closed connection — usually
 * recoverable on retry because pg.Pool's 'error' handler evicts the bad
 * client and the next attempt grabs a fresh one. We do NOT retry on
 * application-level errors (constraint violations, NotFoundException) —
 * those would be wrong to retry.
 */
const RETRYABLE_PRISMA_CODES: ReadonlySet<string> = new Set([
  'P1001', // Can't reach database server
  'P1017', // Server has closed the connection
  'P2024', // Timed out fetching a connection from the pool
  'P2028', // Transaction API error / failed to start
])

/**
 * HIPAA §164.312(e)(2)(ii) (transmission security) — classify the DB
 * connection's transport from DATABASE_URL for the boot-time TLS audit line.
 * Pure + exported so the classification paths are unit-testable without
 * standing up a connection (Humaira N3 / 164.312-T21).
 *
 *   • 'prisma-postgres' — managed Prisma Postgres, which enforces
 *     sslmode=require by default and refuses plaintext connections at the
 *     driver level (Lakshitha's encryption report, 2026-06-24). Always TLS.
 *   • 'sslmode'         — an explicit sslmode=require / sslmode=verify-* in
 *     the connection string.
 *   • 'missing-prod'    — no TLS signal AND NODE_ENV=production → the caller
 *     must refuse to start.
 *   • 'missing-dev'     — no TLS signal outside production (local dev) → warn
 *     only.
 */
export type DbTlsClassification =
  | 'prisma-postgres'
  | 'sslmode'
  | 'missing-prod'
  | 'missing-dev'

export function classifyDbTls(
  url: string,
  nodeEnv: string | undefined,
): DbTlsClassification {
  const isPrismaPostgres =
    url.includes('db.prisma.io') || url.includes('pooled.db.prisma.io')
  const hasSslMode = /sslmode=require|sslmode=verify/i.test(url)

  if (isPrismaPostgres) return 'prisma-postgres'
  if (hasSslMode) return 'sslmode'
  if (nodeEnv === 'production') return 'missing-prod'
  return 'missing-dev'
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name)
  private readonly configService: ConfigService

  constructor(configService: ConfigService) {
    const dbUrl = configService.get<string>('DATABASE_URL')!
    const isAccelerate = dbUrl.startsWith('prisma://')

    if (isAccelerate) {
      super({ accelerateUrl: dbUrl })
    } else {
      // Pool tuning for managed Prisma Postgres (db.prisma.io):
      //   • max=20 — headroom for concurrent intake transactions; default 10
      //     was triggering P2028 (transaction-acquire timeout) under burst.
      //   • idleTimeoutMillis=30s — recycle connections before the managed
      //     proxy kills them server-side. Default 10s should also work but
      //     this gives breathing room without holding stale connections.
      //   • keepAlive=true — OS-level TCP keepalive probes idle sockets so
      //     the proxy doesn't silently close them, surfacing as "Server has
      //     closed the connection" on the next query.
      const pool = new pg.Pool({
        connectionString: dbUrl,
        max: 20,
        idleTimeoutMillis: 30_000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
      })
      // Surface late-stage pool errors instead of crashing the process —
      // node-postgres emits 'error' on the pool when an idle client throws
      // (e.g. server-side disconnect). Logging here makes the next failure
      // diagnosable rather than silent.
      pool.on('error', (err: Error) => {
        console.error('⚠️  pg.Pool error on idle client:', err.message)
      })
      const adapter = new PrismaPg(pool)
      super({ adapter })
    }

    this.configService = configService
  }

  async onModuleInit() {
    const dbUrl = this.configService.get<string>('DATABASE_URL') ?? '(not set)'
    const masked = dbUrl.replace(/:([^@]+)@/, ':***@')
    console.log(`🔌 Connecting to database: ${masked}`)
    try {
      await this.$connect()
    } catch (err) {
      console.error('❌ Database connection failed:', err)
      throw err
    }
    console.log('✅ Database connected')

    // HIPAA §164.312(e)(2)(ii) — audit evidence that the running instance is
    // actually TLS-connected. Prisma Postgres enforces sslmode=require by
    // default and refuses plaintext connections; this line records that fact
    // so compliance reviews can point at a log rather than infer it. In
    // production a DATABASE_URL with no TLS signal at all is a hard stop.
    switch (classifyDbTls(dbUrl, this.configService.get<string>('NODE_ENV'))) {
      case 'prisma-postgres':
        this.logger.log(
          '🔐 Database connection: Prisma Postgres (TLS mandatory, always-on)',
        )
        break
      case 'sslmode':
        this.logger.log(
          '🔐 Database connection: sslmode=require present in DATABASE_URL',
        )
        break
      case 'missing-prod':
        throw new Error(
          'DATABASE_URL missing sslmode=require in production — refusing to start',
        )
      case 'missing-dev':
        this.logger.warn(
          '⚠️  Database connection: no sslmode in DATABASE_URL (local dev only)',
        )
        break
    }

    try {
      const enableVectorIndexSetup =
        this.configService.get<string>('ENABLE_VECTOR_INDEX_SETUP') === 'true' ||
        this.configService.get<string>('NODE_ENV') === 'production'

      if (!enableVectorIndexSetup) return

      await this.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`)

      await this.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "hnsw_index"
        ON "DocumentVector"
        USING hnsw ("embedding" vector_cosine_ops)
      `)
      console.log('✅ HNSW index verified/created')
    } catch (error) {
      console.warn(
        '⚠️  Failed to create HNSW index (might already be correct or extension missing):',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /**
   * Wrap a read-side Prisma operation in one-shot retry on connection-level
   * failures. Use for hot read paths (notifications bell, dashboard polling,
   * page-load queries) where the dev DB's first-after-idle query sometimes
   * hits a stale TCP connection in the pg.Pool — pool evicts the bad client
   * via its 'error' handler, second attempt gets a fresh one.
   *
   * Do NOT use this for mutations — application-level retries on writes risk
   * double-execution. Mutations should use `$transaction` (which Prisma
   * retries internally on serialization failures) or be made idempotent.
   *
   * Retries only on RETRYABLE_PRISMA_CODES (P1001 / P1017 / P2024 / P2028)
   * and on driver-level ConnectionClosed kind. Everything else propagates.
   */
  async withConnectionRetry<T>(fn: () => Promise<T>, label = 'query'): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      const code = (err as { code?: unknown })?.code
      const driverKind = (err as { meta?: { driverAdapterError?: { cause?: { kind?: string } } } })
        ?.meta?.driverAdapterError?.cause?.kind
      const isRetryable =
        (typeof code === 'string' && RETRYABLE_PRISMA_CODES.has(code)) ||
        driverKind === 'ConnectionClosed'

      if (!isRetryable) throw err

      this.logger.warn(
        `Prisma ${label} hit ${code ?? driverKind} — retrying once after 200ms`,
      )
      await new Promise((r) => setTimeout(r, 200))
      return await fn()
    }
  }
}
