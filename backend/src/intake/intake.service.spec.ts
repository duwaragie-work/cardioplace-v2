import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { PrismaService } from '../prisma/prisma.service.js'
import { DrugEnrichmentService } from '../drug-enrichment/drug-enrichment.service.js'
import { PatientAccessService } from '../common/patient-access.service.js'
import { IntakeService } from './intake.service.js'

// IVR-18 — listMedications filter scoping. The REJECTED exclusion is opt-out
// (default ON) so rejected meds don't get re-asked in the check-in or
// re-prefilled into the intake/edit wizard; the admin reconciliation tab and
// the read-only patient profile pass includeRejected=true to surface them
// with a status badge. The discontinued exclusion is the pre-existing opt-out.
describe('IntakeService.listMedications filter scoping', () => {
  let service: IntakeService
  let findMany: jest.Mock<any>

  beforeEach(async () => {
    findMany = (jest.fn() as jest.Mock<any>).mockResolvedValue([])
    const prisma = { patientMedication: { findMany } }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntakeService,
        { provide: PrismaService, useValue: prisma },
        { provide: DrugEnrichmentService, useValue: {} },
        { provide: PatientAccessService, useValue: {} },
      ],
    }).compile()

    service = module.get<IntakeService>(IntakeService)
  })

  function whereOf(callIndex = 0) {
    return findMany.mock.calls[callIndex][0].where
  }

  it('default: excludes both discontinued and REJECTED', async () => {
    await service.listMedications('u1')
    expect(whereOf()).toEqual({
      userId: 'u1',
      discontinuedAt: null,
      verificationStatus: { not: 'REJECTED' },
    })
  })

  it('includeRejected=true: keeps REJECTED, still excludes discontinued', async () => {
    await service.listMedications('u1', false, true)
    expect(whereOf()).toEqual({ userId: 'u1', discontinuedAt: null })
  })

  it('includeDiscontinued=true only: keeps discontinued, still excludes REJECTED', async () => {
    await service.listMedications('u1', true, false)
    expect(whereOf()).toEqual({ userId: 'u1', verificationStatus: { not: 'REJECTED' } })
  })

  it('both flags true (admin reconciliation): no status/discontinued filter', async () => {
    await service.listMedications('u1', true, true)
    expect(whereOf()).toEqual({ userId: 'u1' })
  })
})

// Profile fixture with the Date fields serializeProfile() needs.
function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prof1',
    userId: 'p1',
    gender: 'FEMALE',
    heightCm: 165,
    isPregnant: false,
    pregnancyDueDate: null,
    historyPreeclampsia: false,
    hasHeartFailure: false,
    heartFailureType: 'NOT_APPLICABLE',
    hasAFib: false,
    hasCAD: false,
    hasHCM: false,
    hasDCM: false,
    hasTachycardia: false,
    hasBradycardia: false,
    diagnosedHypertension: true,
    profileVerificationStatus: 'VERIFIED',
    profileVerifiedAt: null,
    profileVerifiedBy: null,
    profileLastEditedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

const ADMIN = { id: 'admin', roles: [] } as never

async function makeService(prisma: unknown): Promise<IntakeService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      IntakeService,
      { provide: PrismaService, useValue: prisma },
      { provide: DrugEnrichmentService, useValue: {} },
      { provide: PatientAccessService, useValue: { assertCanAccessPatient: jest.fn() } },
    ],
  }).compile()
  return module.get<IntakeService>(IntakeService)
}

describe('IntakeService.confirmProfileFields (IVR-08)', () => {
  let service: IntakeService
  let prisma: any

  beforeEach(async () => {
    prisma = {
      patientProfile: {
        findUnique: (jest.fn() as jest.Mock<any>).mockResolvedValue(makeProfile()),
      },
      profileVerificationLog: {
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
        createMany: (jest.fn() as jest.Mock<any>).mockResolvedValue({ count: 0 }),
      },
    }
    service = await makeService(prisma)
  })

  it('writes one ADMIN_VERIFY log per valid field', async () => {
    const res = await service.confirmProfileFields(ADMIN, 'p1', {
      fields: ['gender', 'hasHCM'],
    })
    expect(prisma.profileVerificationLog.createMany).toHaveBeenCalledTimes(1)
    const rows = prisma.profileVerificationLog.createMany.mock.calls[0][0].data
    expect(rows).toHaveLength(2)
    expect(rows.every((r: any) => r.changeType === 'ADMIN_VERIFY')).toBe(true)
    expect(rows.map((r: any) => r.fieldPath).sort()).toEqual([
      'profile.gender',
      'profile.hasHCM',
    ])
    expect([...res.confirmedFields].sort()).toEqual(['gender', 'hasHCM'])
  })

  it('skips a field already confirmed (no duplicate ADMIN_VERIFY row)', async () => {
    prisma.profileVerificationLog.findMany.mockResolvedValue([
      { fieldPath: 'profile.gender', changeType: 'ADMIN_VERIFY' },
    ])
    await service.confirmProfileFields(ADMIN, 'p1', { fields: ['gender', 'hasHCM'] })
    const rows = prisma.profileVerificationLog.createMany.mock.calls[0][0].data
    expect(rows.map((r: any) => r.fieldPath)).toEqual(['profile.hasHCM'])
  })

  it('writes nothing when every requested field is already confirmed', async () => {
    prisma.profileVerificationLog.findMany.mockResolvedValue([
      { fieldPath: 'profile.gender', changeType: 'ADMIN_VERIFY' },
    ])
    const res = await service.confirmProfileFields(ADMIN, 'p1', { fields: ['gender'] })
    expect(prisma.profileVerificationLog.createMany).not.toHaveBeenCalled()
    expect(res.confirmedFields).toEqual([])
  })

  it('rejects when no valid profile fields are supplied', async () => {
    await expect(
      service.confirmProfileFields(ADMIN, 'p1', { fields: ['bogusField'] }),
    ).rejects.toThrow()
    expect(prisma.profileVerificationLog.createMany).not.toHaveBeenCalled()
  })
})

describe('IntakeService.rejectProfileField idempotency (IVR-16)', () => {
  let service: IntakeService
  let prisma: any

  beforeEach(async () => {
    prisma = {
      patientProfile: {
        findUnique: (jest.fn() as jest.Mock<any>).mockResolvedValue(
          makeProfile({ hasHCM: true }),
        ),
        update: (jest.fn() as jest.Mock<any>).mockResolvedValue(
          makeProfile({ profileVerificationStatus: 'UNVERIFIED' }),
        ),
      },
      profileVerificationLog: {
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
        create: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
      },
      notification: {
        create: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
      },
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    }
    service = await makeService(prisma)
  })

  it('no-ops (no audit rows) when the field is already rejected', async () => {
    prisma.profileVerificationLog.findMany.mockResolvedValue([
      { fieldPath: 'profile.hasHCM', changeType: 'ADMIN_REJECT' },
    ])
    const res = await service.rejectProfileField(ADMIN, 'p1', { field: 'hasHCM' })
    expect(res.message).toMatch(/already rejected/i)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('writes the field-reject + status-flip rows when not already rejected', async () => {
    prisma.profileVerificationLog.findMany.mockResolvedValue([])
    await service.rejectProfileField(ADMIN, 'p1', { field: 'hasHCM' })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    const ops = prisma.$transaction.mock.calls[0][0]
    expect(ops).toHaveLength(3) // update + ADMIN_REJECT(field) + ADMIN_REJECT(status flip)
  })

  it('dispatches a patient re-check notification naming the field on a fresh reject', async () => {
    prisma.profileVerificationLog.findMany.mockResolvedValue([])
    await service.rejectProfileField(ADMIN, 'p1', { field: 'hasBradycardia' })
    expect(prisma.notification.create).toHaveBeenCalledTimes(1)
    const arg = prisma.notification.create.mock.calls[0][0].data
    expect(arg.userId).toBe('p1') // the patient, not the admin actor
    expect(arg.channel).toBe('PUSH') // lands in the patient Notifications tab
    expect(arg.body).toMatch(/bradycardia history/i) // names the rejected field
  })

  it('does not notify the patient on an idempotent no-op reject', async () => {
    prisma.profileVerificationLog.findMany.mockResolvedValue([
      { fieldPath: 'profile.hasHCM', changeType: 'ADMIN_REJECT' },
    ])
    await service.rejectProfileField(ADMIN, 'p1', { field: 'hasHCM' })
    expect(prisma.notification.create).not.toHaveBeenCalled()
  })
})

// Verify hard-gate: "Verification complete" must not flip the whole profile to
// VERIFIED while any field's latest log is ADMIN_REJECT (a rejected field is an
// open "needs correction" item). Mirrors the FE button-disable + banner.
describe('IntakeService.verifyProfile reject hard-gate', () => {
  let service: IntakeService
  let prisma: any

  beforeEach(async () => {
    prisma = {
      patientProfile: {
        findUnique: (jest.fn() as jest.Mock<any>).mockResolvedValue(
          makeProfile({ profileVerificationStatus: 'UNVERIFIED' }),
        ),
        update: (jest.fn() as jest.Mock<any>).mockResolvedValue(
          makeProfile({ profileVerificationStatus: 'VERIFIED' }),
        ),
      },
      profileVerificationLog: {
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
        create: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
      },
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    }
    service = await makeService(prisma)
  })

  it('throws and does not flip the profile when a field is still rejected', async () => {
    prisma.profileVerificationLog.findMany.mockResolvedValue([
      { fieldPath: 'profile.gender', changeType: 'ADMIN_REJECT' },
      { fieldPath: 'profile.hasBradycardia', changeType: 'ADMIN_REJECT' },
    ])
    await expect(
      service.verifyProfile(ADMIN, 'p1', {} as never),
    ).rejects.toThrow(/resolve rejected field/i)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('verifies when no field is rejected (latest logs are ADMIN_VERIFY)', async () => {
    prisma.profileVerificationLog.findMany.mockResolvedValue([
      { fieldPath: 'profile.gender', changeType: 'ADMIN_VERIFY' },
    ])
    const res = await service.verifyProfile(ADMIN, 'p1', {} as never)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(res.message).toMatch(/profile verified/i)
  })
})

// Manual-test round 2 Group A4 — caregiver name resolution. Caregiver-scoped
// logs use fieldPath `caregiver:${id}`; the listVerificationLogs endpoint
// batch-fetches PatientCaregiver and injects caregiverName + relationship so
// the admin TimelineTab renders "Caregiver Jane Doe (daughter)" instead of
// "caregiver:9a0446d9-…".
describe('IntakeService.listVerificationLogs caregiver resolution (Round 2 A4)', () => {
  let service: IntakeService
  let prisma: any

  beforeEach(async () => {
    prisma = {
      profileVerificationLog: { findMany: jest.fn() },
      patientCaregiver: { findMany: jest.fn() },
      user: { findMany: (jest.fn() as any).mockResolvedValue([]) },
    }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntakeService,
        { provide: PrismaService, useValue: prisma },
        { provide: DrugEnrichmentService, useValue: {} },
        { provide: PatientAccessService, useValue: {} },
      ],
    }).compile()
    service = module.get<IntakeService>(IntakeService)
  })

  it('resolves caregiverName + caregiverRelationship for caregiver:-scoped logs', async () => {
    prisma.profileVerificationLog.findMany.mockResolvedValue([
      {
        id: 'l1',
        fieldPath: 'caregiver:cg-1',
        changedBy: 'admin-1',
        changedByRole: 'ADMIN',
        changeType: 'ADMIN_CORRECT',
        createdAt: new Date(),
      },
      {
        id: 'l2',
        fieldPath: 'profile.gender',
        changedBy: 'admin-1',
        changedByRole: 'ADMIN',
        changeType: 'ADMIN_VERIFY',
        createdAt: new Date(),
      },
    ])
    prisma.patientCaregiver.findMany.mockResolvedValue([
      { id: 'cg-1', name: 'Jane Doe', relationship: 'daughter' },
    ])

    const out = await service.listVerificationLogs('p1')
    expect(prisma.patientCaregiver.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['cg-1'] } },
      select: { id: true, name: true, relationship: true },
    })
    const rows = out.data as Array<any>
    const caregiverRow = rows.find((r) => r.id === 'l1')
    const profileRow = rows.find((r) => r.id === 'l2')
    expect(caregiverRow.caregiverName).toBe('Jane Doe')
    expect(caregiverRow.caregiverRelationship).toBe('daughter')
    expect(profileRow.caregiverName).toBeNull()
    expect(profileRow.caregiverRelationship).toBeNull()
  })

  it('handles a deleted caregiver — caregiverName falls back to null', async () => {
    prisma.profileVerificationLog.findMany.mockResolvedValue([
      {
        id: 'l1',
        fieldPath: 'caregiver:cg-gone',
        changedBy: 'admin-1',
        changedByRole: 'ADMIN',
        changeType: 'ADMIN_CORRECT',
        createdAt: new Date(),
      },
    ])
    prisma.patientCaregiver.findMany.mockResolvedValue([])

    const out = await service.listVerificationLogs('p1')
    const rows = out.data as Array<any>
    expect(rows[0].caregiverName).toBeNull()
    expect(rows[0].caregiverRelationship).toBeNull()
  })

  it('skips the caregiver batch fetch when no logs are caregiver-scoped', async () => {
    prisma.profileVerificationLog.findMany.mockResolvedValue([
      {
        id: 'l1',
        fieldPath: 'profile.hasHCM',
        changedBy: 'patient-1',
        changedByRole: 'PATIENT',
        changeType: 'PATIENT_REPORT',
        createdAt: new Date(),
      },
    ])
    await service.listVerificationLogs('p1')
    expect(prisma.patientCaregiver.findMany).not.toHaveBeenCalled()
  })
})

// F13 — ACE/ARB contraindication is load-bearing on med re-add. When the
// provider has set PatientProfile.aceContraindicatedAt (post-angioedema), a
// re-added ACE inhibitor / ARB must be HELD for provider review and the care
// team notified — never silently trusted.
describe('IntakeService.createMedications — F13 ACE/ARB contraindication', () => {
  let service: IntakeService
  let prisma: any

  function buildPrisma(aceContraindicatedAt: Date | null, primaryProviderId: string | null = 'prov-1') {
    let createdId = 0
    return {
      patientProfile: {
        findUnique: (jest.fn() as any).mockResolvedValue({
          aceContraindicatedAt,
          profileVerificationStatus: 'VERIFIED',
        }),
        update: (jest.fn() as any).mockResolvedValue({}),
      },
      patientMedication: {
        findMany: (jest.fn() as any).mockResolvedValue([]),
        create: (jest.fn() as any).mockImplementation((args: any) =>
          Promise.resolve({ id: `med-${++createdId}`, reportedAt: new Date(), discontinuedAt: null, ...args.data }),
        ),
      },
      profileVerificationLog: { createMany: (jest.fn() as any).mockResolvedValue({}) },
      patientProviderAssignment: {
        findUnique: (jest.fn() as any).mockResolvedValue(
          primaryProviderId ? { primaryProviderId } : null,
        ),
      },
      notification: { create: (jest.fn() as any).mockResolvedValue({}) },
      $transaction: (fn: any) => Promise.resolve(fn(prismaRef())),
    }
  }
  let _prisma: any
  const prismaRef = () => _prisma

  async function makeService(p: any) {
    _prisma = p
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntakeService,
        { provide: PrismaService, useValue: p },
        { provide: DrugEnrichmentService, useValue: { enrich: jest.fn() } },
        { provide: PatientAccessService, useValue: {} },
      ],
    }).compile()
    return module.get<IntakeService>(IntakeService)
  }

  const aceDto = {
    medications: [
      { drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', frequency: 'ONCE_DAILY', source: 'PATIENT_SELF_REPORT' },
    ],
  } as any

  it('contraindicated patient re-adding an ACE inhibitor → held AWAITING_PROVIDER + provider notified', async () => {
    prisma = buildPrisma(new Date('2026-05-01T00:00:00Z'))
    service = await makeService(prisma)

    const res: any = await service.createMedications('p1', aceDto)

    const createArg = prisma.patientMedication.create.mock.calls[0][0]
    expect(createArg.data.verificationStatus).toBe('AWAITING_PROVIDER')
    expect(prisma.notification.create).toHaveBeenCalledTimes(1)
    const notif = prisma.notification.create.mock.calls[0][0].data
    expect(notif.userId).toBe('prov-1')
    expect(notif.body).toContain('Lisinopril')
    expect(res.data ?? res.result?.data).toBeDefined()
    expect((res.contraindicatedReadd ?? res.result?.contraindicatedReadd)).toContain('Lisinopril')
  })

  it('NON-contraindicated patient re-adding an ACE inhibitor → UNVERIFIED, no provider notice', async () => {
    prisma = buildPrisma(null)
    service = await makeService(prisma)

    const res: any = await service.createMedications('p1', aceDto)

    const createArg = prisma.patientMedication.create.mock.calls[0][0]
    expect(createArg.data.verificationStatus).toBe('UNVERIFIED')
    expect(prisma.notification.create).not.toHaveBeenCalled()
    expect((res.contraindicatedReadd ?? res.result?.contraindicatedReadd) ?? []).toHaveLength(0)
  })
})
