// N7 smoke spec — boot the module wiring (with a fake Prisma) and prove:
//   1. AuditExceptionReportService is instantiable via DI
//   2. AuditFailureTallyService.onModuleInit fires → tally sink is registered
//      on the write-with-retry singleton
//   3. The @Cron('0 3 * * *') on scheduledRun is picked up by @nestjs/schedule
//      (SchedulerRegistry contains one CronJob after boot)
//   4. CRON_LABEL_TO_PRINCIPAL registry contains 'cron-audit-exception-report'
//
// Deliberately NOT a full AppModule boot — that pulls Prisma against a real
// DB. This is DI-only wiring verification.
import { jest } from '@jest/globals'
import { Module } from '@nestjs/common'
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule'
import { Test, TestingModule } from '@nestjs/testing'
import { ClsModule } from 'nestjs-cls'
import { AuditFailureTallyService } from '../common/audit/audit-failure-tally.service.js'
import { CRON_LABEL_TO_PRINCIPAL } from '../common/cls/system-principals.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { AuditExceptionReportService } from './audit-exception-report.service.js'
import { AuditExceptionWriter } from './audit-exception-report/audit-exception-writer.js'

function fakePrisma() {
  return {
    accessLog: { findMany: jest.fn<any>().mockResolvedValue([]) },
    authLog: { findMany: jest.fn<any>().mockResolvedValue([]) },
    emailDisclosureLog: { findMany: jest.fn<any>().mockResolvedValue([]) },
    auditWriteFailureTally: {
      findMany: jest.fn<any>().mockResolvedValue([]),
      upsert: jest.fn<any>().mockResolvedValue({ id: 't-1' }),
    },
    user: { findMany: jest.fn<any>().mockResolvedValue([]) },
    auditException: {
      findUnique: jest.fn<any>().mockResolvedValue(null),
      create: jest.fn<any>().mockResolvedValue({ id: 'ae-1' }),
      update: jest.fn<any>().mockResolvedValue({ id: 'ae-1' }),
    },
  }
}

// Local module bundling just the N7 wiring pieces we're testing — avoids
// pulling AppModule (which needs a real DB) into the test graph.
@Module({
  imports: [
    ClsModule.forRoot({ global: true, middleware: { mount: false } }),
    ScheduleModule.forRoot(),
  ],
  providers: [
    { provide: PrismaService, useValue: fakePrisma() },
    AuditFailureTallyService,
    AuditExceptionWriter,
    AuditExceptionReportService,
  ],
})
class N7SmokeModule {}

describe('N7 smoke — Nest DI wiring', () => {
  let mod: TestingModule

  beforeAll(async () => {
    mod = await Test.createTestingModule({ imports: [N7SmokeModule] }).compile()
    await mod.init()
  })

  afterAll(async () => {
    await mod.close()
  })

  it('resolves AuditExceptionReportService from the DI container', () => {
    const svc = mod.get(AuditExceptionReportService)
    expect(svc).toBeInstanceOf(AuditExceptionReportService)
  })

  it('resolves AuditExceptionWriter', () => {
    const writer = mod.get(AuditExceptionWriter)
    expect(writer).toBeInstanceOf(AuditExceptionWriter)
  })

  it('resolves AuditFailureTallyService', () => {
    const tally = mod.get(AuditFailureTallyService)
    expect(tally).toBeInstanceOf(AuditFailureTallyService)
  })

  it('@Cron("0 3 * * *") on scheduledRun is registered with SchedulerRegistry', () => {
    const reg = mod.get(SchedulerRegistry)
    const jobs = reg.getCronJobs()
    // The @Cron() decorator on AuditExceptionReportService.scheduledRun MUST
    // register exactly one CronJob (there are no other cron providers in the
    // smoke module). Proves Nest's discovery pipeline picked up the decorator.
    expect(jobs.size).toBe(1)
    // The registered cron pattern must be '0 3 * * *' (03:00 UTC daily).
    const job = [...jobs.values()][0]
    // Both node-cron implementations Nest supports expose the pattern via
    // cronTime.source (string) or cronTime.toString().
    const src =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (job as any).cronTime?.source?.toString?.() ?? (job as any).cronTime?.toString?.() ?? ''
    // eslint-disable-next-line no-console
    console.log('Registered cron pattern:', src)
    expect(src).toContain('0 3 * * *')
  })

  it('CRON_LABEL_TO_PRINCIPAL contains cron-audit-exception-report → audit-exception-report', () => {
    expect(CRON_LABEL_TO_PRINCIPAL['cron-audit-exception-report']).toBe(
      'audit-exception-report',
    )
  })

  it('AuditFailureTallyService.record() upserts the (kind, hourBucket) row', async () => {
    const tally = mod.get(AuditFailureTallyService)
    const prisma = mod.get(PrismaService) as unknown as ReturnType<typeof fakePrisma>
    await tally.record('access-log', 'ETIMEDOUT', new Date('2026-07-10T05:37:00Z'))
    expect(prisma.auditWriteFailureTally.upsert).toHaveBeenCalledTimes(1)
    const args = prisma.auditWriteFailureTally.upsert.mock.calls[0][0] as any
    // Rounded DOWN to the hour in UTC.
    expect(args.where.kind_hourBucket.hourBucket).toEqual(new Date('2026-07-10T05:00:00Z'))
    expect(args.create.count).toBe(1)
    expect(args.update.count).toEqual({ increment: 1 })
  })
})
