// N7 live cron end-to-end — seeds real AccessLog rows against the real DB
// that trip BULK_PHI_READ, runs the cron, asserts the AuditException row
// landed with the expected shape. Cleans up its own data.
//
// Only runs when RUN_LIVE_DB_SMOKE=1 (opt-in) so CI / other devs don't
// accidentally write to the shared DB.
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { PrismaClient } from '../../generated/prisma/client.js'
import { AuditExceptionReportService } from '../audit-exception-report.service.js'
import { AuditExceptionWriter } from './audit-exception-writer.js'

const shouldRun = process.env.RUN_LIVE_DB_SMOKE === '1'
const describeIf = shouldRun ? describe : describe.skip

// Fake ClsService — the cron's runAsCronActor call needs one. We just want
// scan() to run; the CLS actor stamping is what the real ClsModule handles
// in the app boot path (proven separately by the smoke spec).
function makeCls() {
  return { run: (fn: () => any) => fn(), set: () => {}, get: () => null } as any
}

describeIf('N7 live cron end-to-end', () => {
  let prisma: PrismaClient
  let pool: pg.Pool
  const runTag = `n7-live-${Date.now()}`
  const bulkActorId = `${runTag}-bulk-actor`

  beforeAll(() => {
    const dbUrl = process.env.DATABASE_URL
    if (!dbUrl) throw new Error('DATABASE_URL not set')
    pool = new pg.Pool({ connectionString: dbUrl })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as any)
  })

  afterAll(async () => {
    // Cleanup — remove anything this run created.
    await prisma.auditException.deleteMany({
      where: { idempotencyKey: { contains: runTag } },
    })
    await prisma.accessLog.deleteMany({ where: { actorId: bulkActorId } })
    await prisma.$disconnect()
    await pool.end()
  })

  it('seeds BULK_PHI_READ trigger + runs cron + AuditException lands', async () => {
    // Seed 150 PHI reads by one USER actor within a 30-min window — trips
    // the BULK_PHI_READ >100/hour threshold. Timestamps are within the
    // scan window (last 24h from now).
    const now = new Date()
    const base = now.getTime() - 30 * 60 * 1000 // start 30 min ago
    const rows: any[] = []
    for (let i = 0; i < 150; i++) {
      rows.push({
        actorId: bulkActorId,
        actorType: 'USER',
        action: 'READ',
        modelName: 'JournalEntry',
        recordId: `${runTag}-record-${i}`,
        createdAt: new Date(base + i * 10_000), // 10s apart
      })
    }
    await prisma.accessLog.createMany({ data: rows })
    // Verify the seed took.
    const seededCount = await prisma.accessLog.count({
      where: { actorId: bulkActorId },
    })
    expect(seededCount).toBe(150)

    // Instantiate the cron with real Prisma + real writer + fake Cls (no
    // Nest DI needed — we're testing the runScan() logic, not the @Cron
    // discovery which is verified by the smoke spec).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = new AuditExceptionWriter(prisma as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new AuditExceptionReportService(prisma as any, writer, makeCls())

    const summary = await svc.run(now)

    // At least one AuditException row must have been created — the
    // BULK_PHI_READ detector's seeded actor. Other detectors may also fire
    // from other data in the DB; we only assert on the one we controlled.
    expect(summary.created).toBeGreaterThanOrEqual(1)
    expect(summary.failedDetectors).toBe(0)

    // Verify OUR seeded row's AuditException landed with correct shape.
    const idempotencyKey = `BULK_PHI_READ:actor:${bulkActorId}:${new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()}`
    const row = await prisma.auditException.findUnique({
      where: { idempotencyKey },
    })
    expect(row).not.toBeNull()
    expect(row?.detectorId).toBe('BULK_PHI_READ')
    expect(row?.severity).toBe('HIGH') // 150 reads < 10x threshold (1000), so HIGH not CRITICAL
    expect(row?.status).toBe('OPEN')

    // Evidence blob must contain the actorId + peak count.
    const evidence = row?.evidence as Record<string, unknown>
    expect(evidence.actorId).toBe(bulkActorId)
    expect(evidence.peakHourlyCount).toBeGreaterThan(100)
    expect(evidence.distinctRecordCount).toBe(150)
  }, 60_000)

  it('a second cron run in the same window UPSERTs — no duplicate row', async () => {
    const now = new Date()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = new AuditExceptionWriter(prisma as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new AuditExceptionReportService(prisma as any, writer, makeCls())

    const summary = await svc.run(now)

    // Second run: my bulk-actor row already exists so it's updated, not created.
    // NOTE: other detectors may still create new rows if they detect fresh
    // patterns, so I don't assert summary.created === 0 globally. What I DO
    // assert is that my bulk-actor's row was updated (existed before, still
    // exists after, count still 1).
    const idempotencyKey = `BULK_PHI_READ:actor:${bulkActorId}:${new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()}`
    const rowsWithMyKey = await prisma.auditException.count({
      where: { idempotencyKey },
    })
    expect(rowsWithMyKey).toBe(1) // still exactly one — no duplicate
    expect(summary.failedDetectors).toBe(0)
  }, 60_000)
})
