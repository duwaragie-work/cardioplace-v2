import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
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
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile()

    service = module.get<IntakeService>(IntakeService)
  })

  function whereOf(callIndex = 0) {
    return (findMany.mock.calls[callIndex][0] as { where: unknown }).where
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

  it('F17: HOLD meds survive the default filter and keep holdReason for the check-in', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 'm1',
        userId: 'u1',
        drugName: 'Cozaar',
        drugClass: 'ARB',
        verificationStatus: 'HOLD',
        holdReason: 'PROVIDER_DIRECTED_HOLD',
        frequency: 'ONCE_DAILY',
        source: 'PATIENT_SELF_REPORT',
        reportedAt: new Date('2026-05-01T00:00:00Z'),
        verifiedAt: null,
        discontinuedAt: null,
      },
    ])
    const res = await service.listMedications('u1')
    // The default filter only carves out REJECTED — HOLD is NOT excluded.
    expect((whereOf() as { verificationStatus: unknown }).verificationStatus).toEqual({ not: 'REJECTED' })
    expect(res.data).toHaveLength(1)
    expect(res.data[0]).toMatchObject({
      verificationStatus: 'HOLD',
      holdReason: 'PROVIDER_DIRECTED_HOLD',
    })
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
    historyHDP: false,
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
      { provide: EventEmitter2, useValue: { emit: jest.fn() } },
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
    expect(arg.dispatchTrigger).toBe('PROFILE_REJECTED') // action → visible in the bell
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
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
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
        // Bug 11 — IntakeService emits intake.updated; sibling test helpers
        // (lines 28 / 128 / 322 / 632) already include this mock.
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
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

// F16 — administrative medication holds consolidate to ONE patient bell row
// per Manisha A1 "Display once". Provider-directed holds name a specific med,
// so each keeps its own row.
describe('IntakeService.verifyMedication — F16 administrative hold dedup', () => {
  let service: IntakeService
  let prisma: any
  let notifications: any[]

  function buildPrisma() {
    notifications = []
    let nid = 0
    return {
      patientMedication: {
        findUnique: (jest.fn() as any).mockImplementation(({ where }: any) =>
          Promise.resolve({
            id: where.id,
            userId: 'patient-1',
            drugName: 'Lisinopril 10mg',
            verificationStatus: 'UNVERIFIED',
          }),
        ),
        update: (jest.fn() as any).mockImplementation((args: any) =>
          Promise.resolve({
            id: args.where.id,
            reportedAt: new Date(),
            verifiedAt: new Date(),
            discontinuedAt: null,
            ...args.data,
          }),
        ),
      },
      profileVerificationLog: { create: (jest.fn() as any).mockResolvedValue({}) },
      notification: {
        findFirst: (jest.fn() as any).mockImplementation(({ where }: any) =>
          Promise.resolve(
            notifications.find(
              (n) =>
                n.userId === where.userId &&
                n.channel === where.channel &&
                n.title === where.title &&
                n.readAt === null,
            ) ?? null,
          ),
        ),
        create: (jest.fn() as any).mockImplementation((args: any) => {
          const row = { id: `notif-${++nid}`, readAt: null, ...args.data }
          notifications.push(row)
          return Promise.resolve(row)
        }),
        update: (jest.fn() as any).mockImplementation((args: any) => {
          const row = notifications.find((n) => n.id === args.where.id)
          Object.assign(row, args.data)
          return Promise.resolve(row)
        }),
      },
      $transaction: (ops: any[]) => Promise.all(ops),
    }
  }

  async function makeService(p: any) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntakeService,
        { provide: PrismaService, useValue: p },
        { provide: DrugEnrichmentService, useValue: { enrich: jest.fn() } },
        { provide: PatientAccessService, useValue: { assertCanAccessPatient: jest.fn() } },
        // Bug 11 — IntakeService emits intake.updated; sibling test helpers
        // (lines 28 / 128 / 322 / 632) already include this mock.
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile()
    return module.get<IntakeService>(IntakeService)
  }

  const actor = { id: 'admin-1', roles: ['MEDICAL_DIRECTOR'] } as any

  it('3 administrative holds → exactly 1 unread "Medicine list review" row', async () => {
    prisma = buildPrisma()
    service = await makeService(prisma)

    for (const medId of ['med-1', 'med-2', 'med-3']) {
      await service.verifyMedication(actor, medId, {
        status: 'HOLD',
        holdReason: 'AWAITING_RECORDS',
      } as any)
    }

    const reviews = notifications.filter(
      (n) => n.title === 'Medicine list review' && n.readAt === null,
    )
    expect(reviews).toHaveLength(1)
    // Only the first created; the next two bumped its timestamp.
    expect(prisma.notification.create).toHaveBeenCalledTimes(1)
    expect(prisma.notification.update).toHaveBeenCalledTimes(2)
  })

  it('provider-directed holds are NOT consolidated — each names its own med', async () => {
    prisma = buildPrisma()
    service = await makeService(prisma)

    for (const medId of ['med-1', 'med-2']) {
      await service.verifyMedication(actor, medId, {
        status: 'HOLD',
        holdReason: 'PROVIDER_DIRECTED_HOLD',
      } as any)
    }

    const pauses = notifications.filter((n) => n.title === 'Please pause a medication')
    expect(pauses).toHaveLength(2)
    expect(prisma.notification.findFirst).not.toHaveBeenCalled()
  })
})

// #92 — admin add medication: ACE/ARB safety gate, provenance, canonical 409.
describe('IntakeService.adminAddMedication (#92)', () => {
  let _prisma: any
  const prismaRef = () => _prisma

  function buildPrisma(opts: {
    aceContraindicatedAt?: Date | null
    activeDup?: any
    nameDup?: any
  }) {
    return {
      patientProfile: {
        findUnique: (jest.fn() as any).mockResolvedValue({
          aceContraindicatedAt: opts.aceContraindicatedAt ?? null,
        }),
      },
      patientMedication: {
        // Two distinct dedup queries: the canonical check keys on
        // `canonicalDrugId`, the defensive fallback keys on `drugName`. Route by
        // the where-clause shape so call order/count doesn't matter.
        findFirst: (jest.fn() as any).mockImplementation((args: any) => {
          if (args?.where?.canonicalDrugId !== undefined) {
            return Promise.resolve(opts.activeDup ?? null)
          }
          if (args?.where?.drugName !== undefined) {
            return Promise.resolve(opts.nameDup ?? null)
          }
          return Promise.resolve(null)
        }),
        create: (jest.fn() as any).mockImplementation((args: any) =>
          Promise.resolve({
            id: 'med-new',
            reportedAt: new Date(),
            discontinuedAt: null,
            verifiedAt: null,
            holdSetAt: null,
            holdEscalationLevel: 0,
            combinationComponents: [],
            ...args.data,
          }),
        ),
      },
      profileVerificationLog: { create: (jest.fn() as any).mockResolvedValue({}) },
      $transaction: (fn: any) => Promise.resolve(fn(prismaRef())),
    }
  }

  async function makeService(p: any) {
    _prisma = p
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntakeService,
        { provide: PrismaService, useValue: p },
        { provide: DrugEnrichmentService, useValue: { enrich: jest.fn() } },
        { provide: PatientAccessService, useValue: { assertCanAccessPatient: jest.fn() } },
        // Bug 11 — IntakeService emits intake.updated via EventEmitter2 so
        // ChatService / VoiceService can invalidate their context caches and
        // push live "intake complete" notices into ongoing voice sessions.
        // Match the sibling test helpers at lines 28 / 128 / 322.
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile()
    return module.get<IntakeService>(IntakeService)
  }

  const actor = { id: 'admin-1', roles: ['SUPER_ADMIN'] as any }

  it('non-contraindicated add → VERIFIED with admin provenance', async () => {
    const prisma = buildPrisma({})
    const service = await makeService(prisma)
    const res: any = await service.adminAddMedication(actor, 'p1', {
      drugName: 'Amlodipine', drugClass: 'DHP_CCB', frequency: 'ONCE_DAILY',
    } as any)

    const data = prisma.patientMedication.create.mock.calls[0][0].data
    expect(data.verificationStatus).toBe('VERIFIED')
    expect(data.verifiedByAdminId).toBe('admin-1')
    expect(data.source).toBe('PROVIDER_ENTERED')
    expect(data.addedByUserId).toBe('admin-1')
    expect(data.addedByRole).toBe('ADMIN')
    expect(data.canonicalDrugId).toBe('amlodipine')
    expect(res.requiresAcknowledgement).toBe(false)
  })

  it('ACE/ARB on angioedema patient → auto PROVIDER_DIRECTED_HOLD + requiresAcknowledgement', async () => {
    const prisma = buildPrisma({ aceContraindicatedAt: new Date('2026-05-01') })
    const service = await makeService(prisma)
    const res: any = await service.adminAddMedication(actor, 'p1', {
      drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', frequency: 'ONCE_DAILY',
    } as any)

    const data = prisma.patientMedication.create.mock.calls[0][0].data
    expect(data.verificationStatus).toBe('HOLD')
    expect(data.holdReason).toBe('PROVIDER_DIRECTED_HOLD')
    expect(data.verifiedByAdminId).toBeNull()
    expect(res.requiresAcknowledgement).toBe(true)
    // Audit row flags the discrepancy.
    expect(prisma.profileVerificationLog.create.mock.calls[0][0].data.discrepancyFlag).toBe(true)
  })

  it('canonical duplicate (Losartan when Cozaar active) → 409 with existing record', async () => {
    const prisma = buildPrisma({
      activeDup: { id: 'existing-cozaar', drugName: 'Cozaar', verificationStatus: 'HOLD', holdReason: 'PROVIDER_DIRECTED_HOLD' },
    })
    const service = await makeService(prisma)
    await expect(
      service.adminAddMedication(actor, 'p1', {
        drugName: 'Losartan', drugClass: 'ARB', frequency: 'ONCE_DAILY',
      } as any),
    ).rejects.toMatchObject({
      response: { error: 'DUPLICATE_CANONICAL_DRUG', existing: { id: 'existing-cozaar' } },
    })
    expect(prisma.patientMedication.create).not.toHaveBeenCalled()
  })

  it('catalog wins on class: provider mis-picks OTHER_UNVERIFIED for Metoprolol → saved as BETA_BLOCKER', async () => {
    const prisma = buildPrisma({})
    const service = await makeService(prisma)
    await service.adminAddMedication(actor, 'p1', {
      drugName: 'Metoprolol', drugClass: 'OTHER_UNVERIFIED', frequency: 'ONCE_DAILY',
    } as any)

    const data = prisma.patientMedication.create.mock.calls[0][0].data
    expect(data.drugClass).toBe('BETA_BLOCKER') // catalog overrides the bad pick
    expect(data.canonicalDrugId).toBe('metoprolol')
    // Audit log records the effective (corrected) class, not the raw pick.
    expect(prisma.profileVerificationLog.create.mock.calls[0][0].data.newValue.drugClass).toBe(
      'BETA_BLOCKER',
    )
  })

  it('off-catalog drug keeps the provider-supplied class (no catalog match)', async () => {
    const prisma = buildPrisma({})
    const service = await makeService(prisma)
    await service.adminAddMedication(actor, 'p1', {
      drugName: 'SomeCustomHerbalThing', drugClass: 'OTHER_UNVERIFIED', frequency: 'ONCE_DAILY',
    } as any)

    const data = prisma.patientMedication.create.mock.calls[0][0].data
    expect(data.drugClass).toBe('OTHER_UNVERIFIED')
    expect(data.canonicalDrugId).toBeNull()
  })

  it('defensive fallback: existing active row with same drugName but NULL canonicalDrugId → 409', async () => {
    // Simulates a pre-fix seed / import row: same name, canonicalDrugId never set.
    // The canonical check misses it (canonicalDrugId query returns null); the
    // drugName fallback catches it.
    const prisma = buildPrisma({
      activeDup: null,
      nameDup: {
        id: 'legacy-metoprolol',
        drugName: 'Metoprolol',
        canonicalDrugId: null,
        verificationStatus: 'VERIFIED',
        holdReason: null,
      },
    })
    const service = await makeService(prisma)
    await expect(
      service.adminAddMedication(actor, 'p1', {
        drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER', frequency: 'ONCE_DAILY',
      } as any),
    ).rejects.toMatchObject({
      response: { error: 'DUPLICATE_CANONICAL_DRUG', existing: { id: 'legacy-metoprolol' } },
    })
    expect(prisma.patientMedication.create).not.toHaveBeenCalled()
  })
})
