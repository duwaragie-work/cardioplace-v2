import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { ClsService } from 'nestjs-cls'
import { EmailService } from '../email/email.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { MonthlyReaskService } from './monthly-reask.service.js'

// runAsCronActor wraps scheduledRun in cls.run — a pass-through stub is enough
// for the unit tests, which call runScan directly.
const clsStub = {
  run: (fn: () => unknown) => fn(),
  set: () => undefined,
  get: () => null,
} as unknown as ClsService

const NOW = new Date('2026-07-07T14:00:00Z')
const DAY = 24 * 60 * 60 * 1000

// A patient whose most-recent med touch is `daysAgo` old.
function patient(over: Partial<any> = {}) {
  const daysAgo = over.daysAgo ?? 40 // stale by default (> REASK_DAYS = 30)
  return {
    id: over.id ?? 'user-1',
    email: 'email' in over ? over.email : 'patient@example.com',
    name: over.name ?? 'Ada',
    patientMedications: over.patientMedications ?? [
      {
        reportedAt: new Date(NOW.getTime() - daysAgo * DAY),
        verifiedAt: null,
      },
    ],
  }
}

describe('MonthlyReaskService', () => {
  let service: MonthlyReaskService
  let prisma: any
  let emailService: { sendEmail: jest.Mock }

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn(),
      },
      notification: {
        findFirst: (jest.fn() as any).mockResolvedValue(null),
        create: (jest.fn() as any).mockResolvedValue({}),
      },
    }
    emailService = { sendEmail: (jest.fn() as any).mockResolvedValue(undefined) }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonthlyReaskService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
        { provide: ClsService, useValue: clsStub },
      ],
    }).compile()
    service = module.get(MonthlyReaskService)
  })

  it('sends both a PUSH and an EMAIL notification, plus a real email, for a stale patient with an email', async () => {
    prisma.user.findMany.mockResolvedValue([patient()])

    const sent = await service.runScan(NOW)

    expect(sent).toBe(1)
    const channels = prisma.notification.create.mock.calls.map(
      (c: any[]) => c[0].data.channel,
    )
    expect(channels).toEqual(['PUSH', 'EMAIL'])
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          channel: 'EMAIL',
          title: 'Confirm your medications',
          dispatchTrigger: 'SYSTEM_CRON',
        }),
      }),
    )
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1)
    const [to, subject, html] = emailService.sendEmail.mock.calls[0]
    expect(to).toBe('patient@example.com')
    expect(subject).toBe('Cardioplace: Confirm your medications')
    expect(html).toContain('Ada')
  })

  it('sends only PUSH (no email) when the patient has no email address', async () => {
    prisma.user.findMany.mockResolvedValue([patient({ email: null })])

    const sent = await service.runScan(NOW)

    expect(sent).toBe(1)
    const channels = prisma.notification.create.mock.calls.map(
      (c: any[]) => c[0].data.channel,
    )
    expect(channels).toEqual(['PUSH'])
    expect(emailService.sendEmail).not.toHaveBeenCalled()
  })

  it('skips patients whose meds were touched within the 30-day window', async () => {
    prisma.user.findMany.mockResolvedValue([patient({ daysAgo: 10 })])

    const sent = await service.runScan(NOW)

    expect(sent).toBe(0)
    expect(prisma.notification.create).not.toHaveBeenCalled()
    expect(emailService.sendEmail).not.toHaveBeenCalled()
  })

  it('is idempotent — sends nothing when a re-ask went out inside the idempotency window', async () => {
    prisma.user.findMany.mockResolvedValue([patient()])
    prisma.notification.findFirst.mockResolvedValue({ id: 'recent' })

    const sent = await service.runScan(NOW)

    expect(sent).toBe(0)
    expect(prisma.notification.create).not.toHaveBeenCalled()
    expect(emailService.sendEmail).not.toHaveBeenCalled()
  })

  it('no patients due → no work', async () => {
    prisma.user.findMany.mockResolvedValue([])

    const sent = await service.runScan(NOW)

    expect(sent).toBe(0)
    expect(prisma.notification.create).not.toHaveBeenCalled()
    expect(emailService.sendEmail).not.toHaveBeenCalled()
  })
})
