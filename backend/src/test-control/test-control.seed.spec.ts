/**
 * Phase 0 §H — unit specs for the 4 endpoints the pre-Phase-0 test-control
 * controller was missing. Prisma is mocked (codebase convention — unit
 * specs never touch a DB; the seed.spec.ts integration test covers the
 * real DB path).
 */
import { jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'
import { TestControlService } from './test-control.service.js'
import { TestControlController } from './test-control.controller.js'

type AnyFn = jest.Mock<(...args: any[]) => any>

function mockPrisma() {
  return {
    user: {
      findUnique: jest.fn() as AnyFn,
      findFirst: jest.fn() as AnyFn,
      update: jest.fn() as AnyFn,
    },
    journalEntry: { create: jest.fn() as AnyFn },
    deviationAlert: { create: jest.fn() as AnyFn, deleteMany: jest.fn() as AnyFn },
    notification: { create: jest.fn() as AnyFn, deleteMany: jest.fn() as AnyFn },
    escalationEvent: { deleteMany: jest.fn() as AnyFn },
    profileVerificationLog: { create: jest.fn() as AnyFn },
    patientProviderAssignment: { findUnique: jest.fn() as AnyFn },
    patientThreshold: { upsert: jest.fn() as AnyFn },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)) as AnyFn,
  }
}

function makeService(prisma: ReturnType<typeof mockPrisma>) {
  // Only `prisma` is exercised by the §H methods — cron/escalation deps are
  // unused, so empty stubs are sufficient for a unit spec.
  return new TestControlService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  )
}

describe('TestControlService — §H seed helpers', () => {
  describe('setAccountStatus', () => {
    it('updates accountStatus for an existing user', async () => {
      const prisma = mockPrisma()
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' })
      prisma.user.update.mockResolvedValue({})
      const svc = makeService(prisma)

      const res = await svc.setAccountStatus('a@b.test', 'SUSPENDED')

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'a@b.test' },
        select: { id: true },
      })
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { accountStatus: 'SUSPENDED' },
      })
      expect(res).toEqual({
        id: 'u1',
        email: 'a@b.test',
        accountStatus: 'SUSPENDED',
      })
    })

    it('throws when the user does not exist', async () => {
      const prisma = mockPrisma()
      prisma.user.findUnique.mockResolvedValue(null)
      const svc = makeService(prisma)
      await expect(svc.setAccountStatus('missing@b.test', 'BLOCKED')).rejects.toThrow(
        /User not found/,
      )
      expect(prisma.user.update).not.toHaveBeenCalled()
    })
  })

  describe('seedAlerts', () => {
    it('creates one JournalEntry + one DeviationAlert per spec and returns ids', async () => {
      const prisma = mockPrisma()
      prisma.journalEntry.create.mockResolvedValue({ id: 'je1' })
      prisma.deviationAlert.create
        .mockResolvedValueOnce({ id: 'al1' })
        .mockResolvedValueOnce({ id: 'al2' })
      const svc = makeService(prisma)

      const res = await svc.seedAlerts('u1', [
        { tier: 'BP_LEVEL_1_HIGH' },
        { tier: 'TIER_1_CONTRAINDICATION', status: 'ACKNOWLEDGED', acknowledgedByUserId: 'md1' },
      ])

      expect(prisma.journalEntry.create).toHaveBeenCalledTimes(2)
      expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(2)
      const secondArg = prisma.deviationAlert.create.mock.calls[1][0] as {
        data: Record<string, unknown>
      }
      expect(secondArg.data).toMatchObject({
        userId: 'u1',
        journalEntryId: 'je1',
        tier: 'TIER_1_CONTRAINDICATION',
        status: 'ACKNOWLEDGED',
        acknowledgedByUserId: 'md1',
      })
      expect(res).toEqual({ created: 2, alertIds: ['al1', 'al2'] })
    })

    it('defaults status to OPEN and ruleId to TEST_SEED', async () => {
      const prisma = mockPrisma()
      prisma.journalEntry.create.mockResolvedValue({ id: 'je1' })
      prisma.deviationAlert.create.mockResolvedValue({ id: 'al1' })
      const svc = makeService(prisma)

      await svc.seedAlerts('u1', [{ tier: 'BP_LEVEL_2' }])

      const arg = prisma.deviationAlert.create.mock.calls[0][0] as {
        data: Record<string, unknown>
      }
      expect(arg.data).toMatchObject({ status: 'OPEN', ruleId: 'TEST_SEED' })
    })
  })

  describe('deleteAlertsForUser', () => {
    it('deletes escalations + alert-linked notifications + alerts (children first) and returns the alert count', async () => {
      const prisma = mockPrisma()
      prisma.escalationEvent.deleteMany.mockResolvedValue({ count: 5 })
      prisma.notification.deleteMany.mockResolvedValue({ count: 3 })
      prisma.deviationAlert.deleteMany.mockResolvedValue({ count: 9 })
      const svc = makeService(prisma)

      const res = await svc.deleteAlertsForUser('u1')

      // Ordered children-first so the alert delete can't be blocked by an FK.
      expect(prisma.escalationEvent.deleteMany).toHaveBeenCalledWith({
        where: { alert: { userId: 'u1' } },
      })
      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', alertId: { not: null } },
      })
      expect(prisma.deviationAlert.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      })
      expect(res).toEqual({ rowsDeleted: 9 })
    })
  })

  describe('seedNotifications', () => {
    it('creates exactly `count` notifications with the given channel', async () => {
      const prisma = mockPrisma()
      prisma.notification.create.mockResolvedValue({})
      const svc = makeService(prisma)

      const res = await svc.seedNotifications('u1', 3, 'PUSH')

      expect(prisma.notification.create).toHaveBeenCalledTimes(3)
      const arg = prisma.notification.create.mock.calls[0][0] as {
        data: Record<string, unknown>
      }
      expect(arg.data).toMatchObject({ userId: 'u1', channel: 'PUSH' })
      expect(res).toEqual({ created: 3 })
    })

    it('defaults channel to DASHBOARD', async () => {
      const prisma = mockPrisma()
      prisma.notification.create.mockResolvedValue({})
      const svc = makeService(prisma)
      await svc.seedNotifications('u1', 1)
      const arg = prisma.notification.create.mock.calls[0][0] as {
        data: Record<string, unknown>
      }
      expect(arg.data).toMatchObject({ channel: 'DASHBOARD' })
    })
  })

  describe('setUserDateOfBirth (Phase 4 §B.2)', () => {
    it('updates the user dateOfBirth with the supplied Date', async () => {
      const prisma = mockPrisma()
      prisma.user.update.mockResolvedValue({})
      const svc = makeService(prisma)
      const dob = new Date('1961-05-18T00:00:00.000Z')

      await svc.setUserDateOfBirth('u1', dob)

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { dateOfBirth: dob },
      })
    })

    it('forwards the exact Date instance (no coercion) for boundary dates', async () => {
      const prisma = mockPrisma()
      prisma.user.update.mockResolvedValue({})
      const svc = makeService(prisma)
      // The day a patient turns exactly 65 — boundary used by spec 20g.1.
      const dob = new Date('1961-05-18T12:34:56.000Z')

      await svc.setUserDateOfBirth('u2', dob)

      const arg = prisma.user.update.mock.calls[0][0] as {
        data: { dateOfBirth: Date }
      }
      expect(arg.data.dateOfBirth).toBe(dob)
      expect(arg.data.dateOfBirth.toISOString()).toBe('1961-05-18T12:34:56.000Z')
    })
  })

  describe('setOnboardingStatus (Phase 4 §C)', () => {
    it('updates onboardingStatus to NOT_COMPLETED', async () => {
      const prisma = mockPrisma()
      prisma.user.update.mockResolvedValue({})
      const svc = makeService(prisma)

      await svc.setOnboardingStatus('u1', 'NOT_COMPLETED')

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { onboardingStatus: 'NOT_COMPLETED' },
      })
    })

    it('updates onboardingStatus to COMPLETED', async () => {
      const prisma = mockPrisma()
      prisma.user.update.mockResolvedValue({})
      const svc = makeService(prisma)

      await svc.setOnboardingStatus('u2', 'COMPLETED')

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u2' },
        data: { onboardingStatus: 'COMPLETED' },
      })
    })
  })

  describe('setPatientThreshold (Phase 4 §B.2)', () => {
    it('upserts using setByProviderId resolved from the assigned medical director', async () => {
      const prisma = mockPrisma()
      prisma.patientProviderAssignment.findUnique.mockResolvedValue({
        medicalDirectorId: 'md1',
        primaryProviderId: 'pp1',
        backupProviderId: 'bp1',
      })
      prisma.patientThreshold.upsert.mockResolvedValue({})
      const svc = makeService(prisma)

      const res = await svc.setPatientThreshold('u1', { sbpUpperTarget: 130 })

      expect(prisma.user.findFirst).not.toHaveBeenCalled()
      expect(prisma.patientThreshold.upsert).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        update: { sbpUpperTarget: 130 },
        create: { userId: 'u1', setByProviderId: 'md1', sbpUpperTarget: 130 },
      })
      expect(res).toEqual({ userId: 'u1' })
    })

    it('falls back to any MEDICAL_DIRECTOR / SUPER_ADMIN when no assignment exists', async () => {
      const prisma = mockPrisma()
      prisma.patientProviderAssignment.findUnique.mockResolvedValue(null)
      prisma.user.findFirst.mockResolvedValue({ id: 'admin9' })
      prisma.patientThreshold.upsert.mockResolvedValue({})
      const svc = makeService(prisma)

      await svc.setPatientThreshold('u2', { sbpLowerTarget: 95 })

      expect(prisma.user.findFirst).toHaveBeenCalled()
      const arg = prisma.patientThreshold.upsert.mock.calls[0][0] as {
        create: Record<string, unknown>
      }
      expect(arg.create).toMatchObject({
        userId: 'u2',
        setByProviderId: 'admin9',
        sbpLowerTarget: 95,
      })
    })
  })

  describe('seedAuditTrail', () => {
    it('creates one ProfileVerificationLog per event with role default ADMIN', async () => {
      const prisma = mockPrisma()
      prisma.profileVerificationLog.create.mockResolvedValue({})
      const svc = makeService(prisma)

      const res = await svc.seedAuditTrail('u1', [
        { changeType: 'ADMIN_VERIFY', fieldPath: 'profile', changedBy: 'admin1' },
        {
          changeType: 'ADMIN_CORRECT',
          fieldPath: 'profile.heightCm',
          changedBy: 'md1',
          changedByRole: 'PROVIDER',
          discrepancyFlag: true,
        },
      ])

      expect(prisma.profileVerificationLog.create).toHaveBeenCalledTimes(2)
      const first = prisma.profileVerificationLog.create.mock.calls[0][0] as {
        data: Record<string, unknown>
      }
      expect(first.data).toMatchObject({
        userId: 'u1',
        changeType: 'ADMIN_VERIFY',
        changedByRole: 'ADMIN',
        discrepancyFlag: false,
      })
      const second = prisma.profileVerificationLog.create.mock.calls[1][0] as {
        data: Record<string, unknown>
      }
      expect(second.data).toMatchObject({
        changedByRole: 'PROVIDER',
        discrepancyFlag: true,
      })
      expect(res).toEqual({ created: 2 })
    })
  })
})

describe('TestControlController — §H auth gating', () => {
  const ORIG = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIG }
  })

  function controller() {
    const svc = {
      setAccountStatus: jest.fn() as AnyFn,
      seedAlerts: jest.fn() as AnyFn,
      seedNotifications: jest.fn() as AnyFn,
      seedAuditTrail: jest.fn() as AnyFn,
    }
    return { ctrl: new TestControlController(svc as never), svc }
  }

  it('rejects when ENABLE_TEST_CONTROL is not set', async () => {
    delete process.env.ENABLE_TEST_CONTROL
    process.env.NODE_ENV = 'test'
    const { ctrl, svc } = controller()
    await expect(
      ctrl.setAccountStatus(undefined as never, { email: 'a@b.test', status: 'ACTIVE' }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(svc.setAccountStatus).not.toHaveBeenCalled()
  })

  it('rejects in production even with the flag on', async () => {
    process.env.ENABLE_TEST_CONTROL = 'true'
    process.env.NODE_ENV = 'production'
    const { ctrl } = controller()
    await expect(
      ctrl.seedAlerts(undefined as never, { userId: 'u1', alerts: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('delegates to the service when authorized', async () => {
    process.env.ENABLE_TEST_CONTROL = 'true'
    process.env.NODE_ENV = 'test'
    delete process.env.TEST_CONTROL_SECRET
    const { ctrl, svc } = controller()
    svc.seedNotifications.mockResolvedValue({ created: 2 })
    const res = await ctrl.seedNotifications(undefined as never, {
      userId: 'u1',
      count: 2,
    })
    expect(svc.seedNotifications).toHaveBeenCalledWith('u1', 2, undefined)
    expect(res).toEqual({ created: 2 })
  })
})
