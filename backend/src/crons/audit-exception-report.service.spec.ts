import { jest } from '@jest/globals'
import { AuditExceptionReportService } from './audit-exception-report.service.js'
import { AuditExceptionWriter } from './audit-exception-report/audit-exception-writer.js'

// Fake ClsService — the service passes through to `runAsCronActor` which
// wraps CLS around the scan, but at this spec's layer we only need a
// resolver that runs its callback.
function makeCls() {
  return {
    run: (fn: () => any) => fn(),
    set: () => {},
    get: () => null,
  } as any
}

// Fake Prisma with just enough surface for every detector's findMany + the
// writer's findUnique/create/update to succeed. Detectors that shouldn't
// fire return []; those that should return the fixture rows.
function makePrisma(opts: {
  accessLogRows?: any[]
  authLogRows?: any[]
  emailDisclosureRows?: any[]
  tallyRows?: any[]
  users?: Record<string, any>
  existingException?: { id: string; status: string } | null
}) {
  const accessFindMany = jest.fn<any>().mockResolvedValue(opts.accessLogRows ?? [])
  const authFindMany = jest.fn<any>().mockResolvedValue(opts.authLogRows ?? [])
  const emailFindMany = jest.fn<any>().mockResolvedValue(opts.emailDisclosureRows ?? [])
  const tallyFindMany = jest.fn<any>().mockResolvedValue(opts.tallyRows ?? [])
  const userFindMany = jest.fn<any>().mockImplementation((args: any) => {
    const ids = args?.where?.id?.in as string[] | undefined
    if (!ids || !opts.users) return Promise.resolve([])
    return Promise.resolve(ids.map((id) => opts.users![id]).filter(Boolean))
  })
  const findUnique = jest.fn<any>().mockResolvedValue(opts.existingException ?? null)
  const createSpy = jest.fn<any>().mockImplementation((args: any) =>
    Promise.resolve({ id: `created-${args.data.detectorId}` }),
  )
  const updateSpy = jest.fn<any>().mockResolvedValue({ id: 'updated' })
  return {
    prisma: {
      accessLog: { findMany: accessFindMany },
      authLog: { findMany: authFindMany },
      emailDisclosureLog: { findMany: emailFindMany },
      auditWriteFailureTally: { findMany: tallyFindMany },
      user: { findMany: userFindMany },
      auditException: { findUnique, create: createSpy, update: updateSpy },
    } as any,
    createSpy,
    updateSpy,
    findUnique,
  }
}

const NOW = new Date('2026-07-10T12:00:00Z')

function buildAllDetectorFixtures() {
  // Fixtures that trip every detector exactly once in the 24h window.
  const authRows = Array.from({ length: 6 }, (_, i) => ({
    identifier: 'bad@example.com',
    userId: null,
    ipAddress: '10.0.0.1',
    event: 'otp_failed',
    errorCode: null,
    practiceContext: 'practice-a',
    createdAt: new Date(Date.parse('2026-07-10T11:59:00Z') - i * 60_000),
    success: false,
  }))
  const bulkReadRows = Array.from({ length: 150 }, (_, i) => ({
    actorId: 'clinician-1',
    modelName: 'JournalEntry',
    recordId: `je-${i}`,
    createdAt: new Date(Date.parse('2026-07-10T11:59:00Z') - i * 30_000),
  }))
  const offHoursRows = Array.from({ length: 6 }, () => ({
    actorId: 'clinician-1',
    modelName: 'JournalEntry',
    recordId: 'je-1',
    // Sunday UTC — off-hours by weekend rule
    createdAt: new Date('2026-07-12T09:00:00Z'),
  }))
  const crossPracticeRows = [
    {
      actorId: 'provider-cross',
      modelName: 'User',
      recordId: 'patient-cross',
      createdAt: new Date('2026-07-10T09:00:00Z'),
    },
  ]
  const users = {
    'provider-cross': {
      id: 'provider-cross',
      roles: ['PROVIDER'],
      practiceProviderMemberships: [{ practiceId: 'practice-a' }],
      practiceMedicalDirectorMemberships: [],
      practiceCoordinator: null,
      providerAssignmentAsPatient: null,
    },
    'patient-cross': {
      id: 'patient-cross',
      roles: ['PATIENT'],
      practiceProviderMemberships: [],
      practiceMedicalDirectorMemberships: [],
      practiceCoordinator: null,
      providerAssignmentAsPatient: { practiceId: 'practice-b' },
    },
  }
  const tallyRows = [
    {
      kind: 'access-log',
      hourBucket: new Date('2026-07-10T04:00:00Z'),
      count: 3,
      lastError: 'DB down',
    },
  ]
  const emailRows = [
    {
      id: 'e-1',
      template: 'welcome',
      patientUserId: null,
      recipientEmail: 'patient@example.com',
      sentAt: new Date('2026-07-10T05:00:00Z'),
      subject: 'hi',
    },
  ]
  return {
    accessLogRows: [...bulkReadRows, ...offHoursRows, ...crossPracticeRows],
    authLogRows: authRows,
    emailDisclosureRows: emailRows,
    tallyRows,
    users,
  }
}

describe('AuditExceptionReportService — N7 cron', () => {
  it('runs all 6 detectors and writes one row per fired candidate', async () => {
    const { prisma, createSpy } = makePrisma(buildAllDetectorFixtures())
    const writer = new AuditExceptionWriter(prisma)
    const svc = new AuditExceptionReportService(prisma, writer, makeCls())

    const summary = await svc.run(NOW)

    // 6 candidates expected — one per detector fixture.
    expect(summary.failedDetectors).toBe(0)
    expect(summary.created).toBe(6)
    expect(summary.updated).toBe(0)
    expect(summary.stickySkipped).toBe(0)
    expect(createSpy).toHaveBeenCalledTimes(6)
    const detectorIds = createSpy.mock.calls
      .map((c) => (c[0] as any).data.detectorId)
      .sort()
    expect(detectorIds).toEqual([
      'BULK_PHI_READ',
      'CROSS_PRACTICE_ACCESS',
      'DROPPED_AUDIT_WRITES',
      'OFF_HOURS_PHI_ACCESS',
      'REPEATED_FAILED_AUTH',
      'UNATTRIBUTED_SYSTEM_DISCLOSURE',
    ])
  })

  it('a second run in the same window UPDATES existing rows, does not duplicate', async () => {
    const { prisma, createSpy, updateSpy } = makePrisma({
      ...buildAllDetectorFixtures(),
      existingException: { id: 'existing-1', status: 'OPEN' },
    })
    const writer = new AuditExceptionWriter(prisma)
    const svc = new AuditExceptionReportService(prisma, writer, makeCls())

    const summary = await svc.run(NOW)

    expect(createSpy).not.toHaveBeenCalled()
    expect(updateSpy).toHaveBeenCalledTimes(6)
    expect(summary.updated).toBe(6)
    expect(summary.created).toBe(0)
  })

  it('a detector crash does NOT abort the remaining detectors', async () => {
    const { prisma, createSpy } = makePrisma(buildAllDetectorFixtures())
    // Force the AccessLog findMany to throw — kills BULK_PHI_READ +
    // OFF_HOURS_PHI_ACCESS + CROSS_PRACTICE_ACCESS. The other 3 detectors
    // read different tables and must still fire.
    ;(prisma.accessLog.findMany as jest.Mock<any>).mockRejectedValue(
      new Error('accessLog scan crashed'),
    )
    const writer = new AuditExceptionWriter(prisma)
    const svc = new AuditExceptionReportService(prisma, writer, makeCls())

    const summary = await svc.run(NOW)

    expect(summary.failedDetectors).toBe(3)
    expect(summary.created).toBe(3)
    expect(createSpy).toHaveBeenCalledTimes(3)
  })

  it('emits zero-candidates path cleanly when no detector fires', async () => {
    const { prisma, createSpy } = makePrisma({}) // all fixtures empty
    const writer = new AuditExceptionWriter(prisma)
    const svc = new AuditExceptionReportService(prisma, writer, makeCls())

    const summary = await svc.run(NOW)

    expect(summary.failedDetectors).toBe(0)
    expect(summary.created).toBe(0)
    expect(summary.updated).toBe(0)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('scans a 24h window ending at `now`', async () => {
    const { prisma } = makePrisma({})
    const writer = new AuditExceptionWriter(prisma)
    const svc = new AuditExceptionReportService(prisma, writer, makeCls())
    await svc.run(NOW)

    const authFindMany = prisma.authLog.findMany as jest.Mock<any>
    const args = authFindMany.mock.calls[0][0] as any
    expect(args.where.createdAt.gte).toEqual(new Date('2026-07-09T12:00:00Z'))
    expect(args.where.createdAt.lt).toEqual(NOW)
  })
})
