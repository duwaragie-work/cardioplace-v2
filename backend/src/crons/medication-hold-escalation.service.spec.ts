import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { ClsService } from 'nestjs-cls'
import { PrismaService } from '../prisma/prisma.service.js'
import { MedicationHoldEscalationService } from './medication-hold-escalation.service.js'

// runAsCronActor wraps scheduledRun in cls.run — a pass-through stub is enough
// for the unit tests, which call runScan directly.
const clsStub = {
  run: (fn: () => unknown) => fn(),
  set: () => undefined,
  get: () => null,
} as unknown as ClsService

// Manisha 5/24 Med §4 — HOLD reconciliation escalation ladder. Each rung fires
// once (holdEscalationLevel idempotency); recipients resolve off the care team.

const NOW = new Date('2026-05-24T15:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function heldMed(over: Partial<any> = {}) {
  return {
    id: over.id ?? 'med-1',
    userId: over.userId ?? 'user-1',
    drugName: over.drugName ?? 'Lisinopril 10mg',
    holdSetAt: over.holdSetAt ?? new Date(NOW.getTime() - 8 * DAY),
    holdEscalationLevel: over.holdEscalationLevel ?? 0,
  }
}

const ASSIGNMENT = {
  userId: 'user-1',
  primaryProviderId: 'prov-1',
  medicalDirectorId: 'md-1',
}

describe('MedicationHoldEscalationService', () => {
  let service: MedicationHoldEscalationService
  let prisma: any

  beforeEach(async () => {
    prisma = {
      patientMedication: {
        findMany: jest.fn(),
        update: (jest.fn() as any).mockResolvedValue({}),
      },
      patientProviderAssignment: {
        findMany: (jest.fn() as any).mockResolvedValue([ASSIGNMENT]),
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
        MedicationHoldEscalationService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClsService, useValue: clsStub },
      ],
    }).compile()
    service = module.get(MedicationHoldEscalationService)
  })

  it('fires the day-7 rung to the primary provider (dashboard) and bumps level to 1', async () => {
    prisma.patientMedication.findMany.mockResolvedValue([
      heldMed({ holdSetAt: new Date(NOW.getTime() - 8 * DAY), holdEscalationLevel: 0 }),
    ])
    const fired = await service.runScan(NOW)
    expect(fired).toBe(1)
    expect(prisma.patientMedication.update).toHaveBeenCalledWith({
      where: { id: 'med-1' },
      data: { holdEscalationLevel: 1 },
    })
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'prov-1',
          patientUserId: 'user-1',
          channel: 'DASHBOARD',
        }),
      }),
    )
  })

  it('day-30 rung notifies primary provider + medical director', async () => {
    prisma.patientMedication.findMany.mockResolvedValue([
      heldMed({ holdSetAt: new Date(NOW.getTime() - 31 * DAY), holdEscalationLevel: 2 }),
    ])
    await service.runScan(NOW)
    const recipientIds = prisma.notification.create.mock.calls.map(
      (c: any[]) => c[0].data.userId,
    )
    expect(recipientIds).toContain('prov-1')
    expect(recipientIds).toContain('md-1')
    expect(prisma.patientMedication.update).toHaveBeenCalledWith({
      where: { id: 'med-1' },
      data: { holdEscalationLevel: 3 },
    })
  })

  it('day-45 CMO rung notifies medical director + ops', async () => {
    prisma.patientMedication.findMany.mockResolvedValue([
      heldMed({ holdSetAt: new Date(NOW.getTime() - 46 * DAY), holdEscalationLevel: 3 }),
    ])
    await service.runScan(NOW)
    const recipientIds = prisma.notification.create.mock.calls.map(
      (c: any[]) => c[0].data.userId,
    )
    expect(recipientIds).toContain('md-1')
    expect(recipientIds).toContain('ops-1')
    expect(prisma.patientMedication.update).toHaveBeenCalledWith({
      where: { id: 'med-1' },
      data: { holdEscalationLevel: 4 },
    })
  })

  it('does not re-fire a rung already reached (idempotent)', async () => {
    prisma.patientMedication.findMany.mockResolvedValue([
      heldMed({ holdSetAt: new Date(NOW.getTime() - 8 * DAY), holdEscalationLevel: 1 }),
    ])
    const fired = await service.runScan(NOW)
    expect(fired).toBe(0)
    expect(prisma.notification.create).not.toHaveBeenCalled()
    expect(prisma.patientMedication.update).not.toHaveBeenCalled()
  })

  it('fires only the highest reached rung when several are crossed at once', async () => {
    // 31 days old, never escalated → jumps straight to level 3.
    prisma.patientMedication.findMany.mockResolvedValue([
      heldMed({ holdSetAt: new Date(NOW.getTime() - 31 * DAY), holdEscalationLevel: 0 }),
    ])
    const fired = await service.runScan(NOW)
    expect(fired).toBe(1)
    expect(prisma.patientMedication.update).toHaveBeenCalledWith({
      where: { id: 'med-1' },
      data: { holdEscalationLevel: 3 },
    })
  })

  it('bumps level but sends nothing when the patient has no care team', async () => {
    prisma.patientProviderAssignment.findMany.mockResolvedValue([])
    prisma.patientMedication.findMany.mockResolvedValue([
      heldMed({ holdSetAt: new Date(NOW.getTime() - 8 * DAY), holdEscalationLevel: 0 }),
    ])
    const fired = await service.runScan(NOW)
    expect(fired).toBe(0)
    expect(prisma.notification.create).not.toHaveBeenCalled()
    // Still bumps so it won't churn this rung every day.
    expect(prisma.patientMedication.update).toHaveBeenCalledWith({
      where: { id: 'med-1' },
      data: { holdEscalationLevel: 1 },
    })
  })

  it('no held meds → no work', async () => {
    prisma.patientMedication.findMany.mockResolvedValue([])
    const fired = await service.runScan(NOW)
    expect(fired).toBe(0)
    expect(prisma.patientProviderAssignment.findMany).not.toHaveBeenCalled()
  })
})
