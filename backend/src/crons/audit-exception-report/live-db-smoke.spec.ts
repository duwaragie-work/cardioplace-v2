// N7 live-DB smoke — proves the migration landed against the real Postgres
// backing DATABASE_URL. Uses PrismaClient directly (no Nest DI) so we
// exercise the exact codegen against the exact schema. Rolls back its own
// inserts so the DB stays clean afterwards.
//
// Only runs when RUN_LIVE_DB_SMOKE=1 (opt-in) so CI / other devs don't
// accidentally write to the shared DB.
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { PrismaClient } from '../../generated/prisma/client.js'

const shouldRun = process.env.RUN_LIVE_DB_SMOKE === '1'
const describeIf = shouldRun ? describe : describe.skip

describeIf('N7 live-DB smoke', () => {
  let prisma: PrismaClient
  let pool: pg.Pool

  beforeAll(() => {
    const dbUrl = process.env.DATABASE_URL
    if (!dbUrl) throw new Error('DATABASE_URL not set — cannot run live-DB smoke')
    if (dbUrl.startsWith('prisma://')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma = new PrismaClient({ accelerateUrl: dbUrl } as any)
    } else {
      pool = new pg.Pool({ connectionString: dbUrl })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as any)
    }
  })

  afterAll(async () => {
    await prisma.$disconnect()
    if (pool) await pool.end()
  })

  it('AuditException + AuditWriteFailureTally exist and accept typed inserts', async () => {
    const idKey = `SMOKE:live-db-smoke:${Date.now()}`
    const created = await prisma.auditException.create({
      data: {
        detectorId: 'BULK_PHI_READ',
        severity: 'HIGH',
        windowStart: new Date('2026-07-10T00:00:00Z'),
        windowEnd: new Date('2026-07-11T00:00:00Z'),
        summary: 'live-db-smoke — proves migration + client shape',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        evidence: { smoke: true, actorId: 'smoke-actor', readCount: 42 } as any,
        practiceContext: null,
        idempotencyKey: idKey,
      },
      select: {
        id: true,
        detectorId: true,
        severity: true,
        status: true,
        idempotencyKey: true,
        summary: true,
      },
    })
    expect(created.detectorId).toBe('BULK_PHI_READ')
    expect(created.severity).toBe('HIGH')
    expect(created.status).toBe('OPEN') // default from schema
    expect(created.idempotencyKey).toBe(idKey)

    // Idempotency uniqueness — a second insert with the same key must fail.
    await expect(
      prisma.auditException.create({
        data: {
          detectorId: 'BULK_PHI_READ',
          severity: 'HIGH',
          windowStart: new Date('2026-07-10T00:00:00Z'),
          windowEnd: new Date('2026-07-11T00:00:00Z'),
          summary: 'duplicate',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          evidence: {} as any,
          practiceContext: null,
          idempotencyKey: idKey,
        },
      }),
    ).rejects.toThrow()

    await prisma.auditException.delete({ where: { id: created.id } })
  })

  it('AuditWriteFailureTally (kind, hourBucket) unique + count increment', async () => {
    const hourBucket = new Date('2026-07-11T13:00:00Z')
    const kind = `smoke-${Date.now()}`

    const first = await prisma.auditWriteFailureTally.upsert({
      where: { kind_hourBucket: { kind, hourBucket } },
      create: { kind, hourBucket, count: 1, lastError: 'test' },
      update: { count: { increment: 1 } },
    })
    expect(first.count).toBe(1)

    const second = await prisma.auditWriteFailureTally.upsert({
      where: { kind_hourBucket: { kind, hourBucket } },
      create: { kind, hourBucket, count: 1, lastError: 'test' },
      update: { count: { increment: 1 } },
    })
    expect(second.count).toBe(2)
    expect(second.id).toBe(first.id) // same row, incremented — not a duplicate

    await prisma.auditWriteFailureTally.delete({ where: { id: first.id } })
  })

  it('EmailDisclosureLog carries all N6-extension columns', async () => {
    const row = await prisma.emailDisclosureLog.create({
      data: {
        senderPrincipal: 'smoke-actor',
        senderType: 'USER',
        senderPracticeContext: 'practice-smoke',
        recipientEmail: 'smoke@example.com',
        recipientCategory: 'PATIENT',
        patientUserId: null,
        template: 'welcome',
        templateVersion: '2026-07-10',
        purpose: 'DIRECT_TO_PATIENT',
        briefDescription: 'live-db smoke row',
        bodyHash: 'a'.repeat(64),
        subject: 'test',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: { smoke: true } as any,
      },
      select: {
        id: true,
        purpose: true,
        recipientCategory: true,
        briefDescription: true,
        bodyHash: true,
        senderPracticeContext: true,
      },
    })
    expect(row.purpose).toBe('DIRECT_TO_PATIENT')
    expect(row.recipientCategory).toBe('PATIENT')
    expect(row.bodyHash).toHaveLength(64)
    expect(row.senderPracticeContext).toBe('practice-smoke')

    await prisma.emailDisclosureLog.delete({ where: { id: row.id } })
  })
})
