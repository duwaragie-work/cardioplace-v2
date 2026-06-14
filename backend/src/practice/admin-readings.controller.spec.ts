import 'reflect-metadata'
import { jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js'
import { PatientAccessService } from '../common/patient-access.service.js'
import { DailyJournalService } from '../daily_journal/daily_journal.service.js'
import { UserRole } from '../generated/prisma/enums.js'
import { AdminReadingsController } from './admin-readings.controller.js'

const mockJournal = {
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
} as any

const mockAccess = {
  assertCanAccessPatient: jest.fn(),
} as any

function req(id = 'admin-1', roles: UserRole[] = [UserRole.SUPER_ADMIN]): any {
  return { user: { id, roles } }
}

describe('AdminReadingsController', () => {
  let controller: AdminReadingsController

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminReadingsController],
      providers: [
        { provide: DailyJournalService, useValue: mockJournal },
        { provide: PatientAccessService, useValue: mockAccess },
      ],
    }).compile()

    controller = module.get<AdminReadingsController>(AdminReadingsController)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  // Clinical write action — role list matches the threshold WRITE scope.
  // OPS (operational, not clinical), COORDINATOR (MVP exclusion pending
  // Manisha) and PATIENT (own app) must NOT pass the global RolesGuard.
  describe('role gating (class-level @Roles)', () => {
    it('admits exactly SUPER_ADMIN, MEDICAL_DIRECTOR, PROVIDER', () => {
      const roles = Reflect.getMetadata(
        ROLES_KEY,
        AdminReadingsController,
      ) as UserRole[]
      expect(roles).toEqual([
        UserRole.SUPER_ADMIN,
        UserRole.MEDICAL_DIRECTOR,
        UserRole.PROVIDER,
      ])
      expect(roles).not.toContain(UserRole.HEALPLACE_OPS)
      expect(roles).not.toContain(UserRole.PATIENT)
    })

    it('no handler widens the class-level role scope', () => {
      for (const handler of [
        controller.create,
        controller.update,
        controller.delete,
      ]) {
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined()
      }
    })
  })

  describe('runtime scope check (assertCanAccessPatient)', () => {
    it('POST checks scope BEFORE delegating, passes actor through', async () => {
      mockAccess.assertCanAccessPatient.mockResolvedValueOnce(undefined)
      mockJournal.create.mockResolvedValueOnce({ statusCode: 202 })

      const dto: any = { measuredAt: '2026-06-12T10:00:00Z', systolicBP: 140, diastolicBP: 90 }
      await controller.create(req('md-1', [UserRole.MEDICAL_DIRECTOR]), 'patient-1', dto)

      expect(mockAccess.assertCanAccessPatient).toHaveBeenCalledWith(
        { id: 'md-1', roles: [UserRole.MEDICAL_DIRECTOR] },
        'patient-1',
      )
      expect(mockJournal.create).toHaveBeenCalledWith('patient-1', dto, {
        id: 'md-1',
        roles: [UserRole.MEDICAL_DIRECTOR],
      })
      const scopeOrder = mockAccess.assertCanAccessPatient.mock.invocationCallOrder[0]
      const createOrder = mockJournal.create.mock.invocationCallOrder[0]
      expect(scopeOrder).toBeLessThan(createOrder)
    })

    it('PUT passes (patientUserId, entryId, dto, actor) to the service', async () => {
      mockAccess.assertCanAccessPatient.mockResolvedValueOnce(undefined)
      mockJournal.update.mockResolvedValueOnce({ statusCode: 200 })

      const dto: any = { systolicBP: 145 }
      await controller.update(req('prov-1', [UserRole.PROVIDER]), 'patient-1', 'entry-1', dto)

      expect(mockJournal.update).toHaveBeenCalledWith('patient-1', 'entry-1', dto, {
        id: 'prov-1',
        roles: [UserRole.PROVIDER],
      })
    })

    it('DELETE passes (patientUserId, entryId, actor) to the service', async () => {
      mockAccess.assertCanAccessPatient.mockResolvedValueOnce(undefined)
      mockJournal.delete.mockResolvedValueOnce({ statusCode: 200 })

      await controller.delete(req(), 'patient-1', 'entry-1')

      expect(mockJournal.delete).toHaveBeenCalledWith('patient-1', 'entry-1', {
        id: 'admin-1',
        roles: [UserRole.SUPER_ADMIN],
      })
    })

    it.each([
      ['create', () => controller.create(req('md-2', [UserRole.MEDICAL_DIRECTOR]), 'p-out', {} as any)],
      ['update', () => controller.update(req('prov-2', [UserRole.PROVIDER]), 'p-out', 'e1', {} as any)],
      ['delete', () => controller.delete(req('prov-2', [UserRole.PROVIDER]), 'p-out', 'e1')],
    ])('out-of-scope MED_DIR/PROVIDER → 403 from %s, service never reached', async (_name, call) => {
      mockAccess.assertCanAccessPatient.mockRejectedValueOnce(
        new ForbiddenException('Patient p-out is outside your role scope'),
      )

      await expect(call()).rejects.toThrow(ForbiddenException)

      expect(mockJournal.create).not.toHaveBeenCalled()
      expect(mockJournal.update).not.toHaveBeenCalled()
      expect(mockJournal.delete).not.toHaveBeenCalled()
    })
  })
})
