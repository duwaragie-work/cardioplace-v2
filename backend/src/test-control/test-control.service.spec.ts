import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { ClsService } from 'nestjs-cls'
import { PrismaService } from '../prisma/prisma.service.js'
import { TestControlService } from './test-control.service.js'
import { GapAlertService } from '../crons/gap-alert.service.js'
import { MonthlyReaskService } from '../crons/monthly-reask.service.js'
import { EscalationService } from '../daily_journal/services/escalation.service.js'
import { MedicationHoldEscalationService } from '../crons/medication-hold-escalation.service.js'

// F33 — the test-control module gains a medication-hold-escalation cron driver
// so the audit + Playwright suites no longer wait for the daily 15:00 UTC cron.
// This exercises the driver end-to-end through the real MedicationHoldEscalation
// service against a mocked Prisma: a hold backdated to T-8d fires the day-7 rung.

const NOW = new Date('2026-05-24T15:00:00Z')
const DAY = 24 * 60 * 60 * 1000

describe('TestControlService — medication-hold escalation cron driver (F33)', () => {
  let service: TestControlService
  let prisma: any

  beforeEach(async () => {
    prisma = {
      patientMedication: {
        findMany: jest.fn(),
        update: (jest.fn() as any).mockResolvedValue({}),
      },
      patientProviderAssignment: {
        findMany: (jest.fn() as any).mockResolvedValue([
          { userId: 'user-1', primaryProviderId: 'prov-1', medicalDirectorId: 'md-1' },
        ]),
      },
      user: {
        findMany: (jest.fn() as any).mockResolvedValue([{ id: 'ops-1' }]),
      },
      notification: {
        create: (jest.fn() as any).mockResolvedValue({}),
      },
    }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestControlService,
        MedicationHoldEscalationService,
        { provide: PrismaService, useValue: prisma },
        // runAsCronActor wraps scheduledRun in cls.run — pass-through stub.
        {
          provide: ClsService,
          useValue: {
            run: (fn: () => unknown) => fn(),
            set: () => undefined,
            get: () => null,
          },
        },
        // The other cron drivers are unused by this path — stub them.
        { provide: GapAlertService, useValue: {} },
        { provide: MonthlyReaskService, useValue: {} },
        { provide: EscalationService, useValue: {} },
      ],
    }).compile()
    service = module.get(TestControlService)
  })

  it('fires ≥1 rung and writes a Notification for a hold backdated to T-8d', async () => {
    prisma.patientMedication.findMany.mockResolvedValue([
      {
        id: 'med-1',
        userId: 'user-1',
        drugName: 'Lisinopril 10mg',
        holdSetAt: new Date(NOW.getTime() - 8 * DAY),
        holdEscalationLevel: 0,
      },
    ])

    const result = await service.runMedicationHoldEscalationScan(NOW)

    expect(result.rungsFired).toBeGreaterThanOrEqual(1)
    expect(prisma.notification.create).toHaveBeenCalled()
  })

  it('fires no rung when there are no held medications', async () => {
    prisma.patientMedication.findMany.mockResolvedValue([])
    const result = await service.runMedicationHoldEscalationScan(NOW)
    expect(result).toEqual({ scanned: 1, rungsFired: 0 })
    expect(prisma.notification.create).not.toHaveBeenCalled()
  })
})
