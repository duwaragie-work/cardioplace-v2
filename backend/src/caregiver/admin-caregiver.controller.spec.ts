import { jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'
import { UserRole } from '../generated/prisma/enums.js'
import { AdminCaregiverController } from './admin-caregiver.controller.js'

// Per-patient access scope on the admin caregiver endpoints. The role check
// (@Roles) is enforced by the guard; here we prove every handler ALSO calls
// PatientAccessService.assertCanAccessPatient(actor, patientId) before touching
// data, so a provider scoped to Practice A can't reach a Practice-B patient's
// caregiver PHI. The practice-scope policy itself is covered by
// patient-access.service.spec.ts — we only assert the wiring + propagation.

const PATIENT = 'patient-b'
const provActor = { id: 'provider-a', roles: [UserRole.PROVIDER] }

function makeReq(actor: { id: string; roles: UserRole[] }) {
  return { user: actor } as any
}

describe('AdminCaregiverController — per-patient access scope', () => {
  let controller: AdminCaregiverController
  let caregiver: {
    list: jest.Mock
    create: jest.Mock
    update: jest.Mock
    remove: jest.Mock
  }
  let access: { assertCanAccessPatient: jest.Mock }

  beforeEach(() => {
    caregiver = {
      list: jest.fn(() => Promise.resolve([])) as any,
      create: jest.fn(() => Promise.resolve({ id: 'cg-1' })) as any,
      update: jest.fn(() => Promise.resolve({ id: 'cg-1' })) as any,
      remove: jest.fn(() => Promise.resolve({ id: 'cg-1' })) as any,
    }
    access = { assertCanAccessPatient: jest.fn(() => Promise.resolve()) as any }
    controller = new AdminCaregiverController(caregiver as any, access as any)
  })

  it('list checks patient access before reading', async () => {
    await controller.list(makeReq(provActor), PATIENT)
    expect(access.assertCanAccessPatient).toHaveBeenCalledWith(
      { id: provActor.id, roles: provActor.roles },
      PATIENT,
    )
    expect(caregiver.list).toHaveBeenCalledWith(PATIENT)
  })

  it('create checks patient access before writing', async () => {
    await controller.create(makeReq(provActor), PATIENT, {} as any)
    expect(access.assertCanAccessPatient).toHaveBeenCalledWith(
      { id: provActor.id, roles: provActor.roles },
      PATIENT,
    )
    expect(caregiver.create).toHaveBeenCalledWith(PATIENT, provActor.id, 'ADMIN', {})
  })

  it('update checks patient access before writing', async () => {
    await controller.update(makeReq(provActor), PATIENT, 'cg-1', {} as any)
    expect(access.assertCanAccessPatient).toHaveBeenCalledWith(
      { id: provActor.id, roles: provActor.roles },
      PATIENT,
    )
    expect(caregiver.update).toHaveBeenCalledWith(PATIENT, 'cg-1', provActor.id, 'ADMIN', {})
  })

  it('remove checks patient access before deleting', async () => {
    await controller.remove(makeReq(provActor), PATIENT, 'cg-1')
    expect(access.assertCanAccessPatient).toHaveBeenCalledWith(
      { id: provActor.id, roles: provActor.roles },
      PATIENT,
    )
    expect(caregiver.remove).toHaveBeenCalledWith(PATIENT, 'cg-1', provActor.id, 'ADMIN')
  })

  it('cross-practice denial propagates and the service is NOT called', async () => {
    access.assertCanAccessPatient.mockRejectedValueOnce(
      new ForbiddenException(`Patient ${PATIENT} is outside your role scope`),
    )
    await expect(controller.list(makeReq(provActor), PATIENT)).rejects.toThrow(
      ForbiddenException,
    )
    expect(caregiver.list).not.toHaveBeenCalled()
  })

  it('write denial propagates and the mutation is NOT called', async () => {
    access.assertCanAccessPatient.mockRejectedValueOnce(new ForbiddenException('denied'))
    await expect(
      controller.create(makeReq(provActor), PATIENT, {} as any),
    ).rejects.toThrow(ForbiddenException)
    expect(caregiver.create).not.toHaveBeenCalled()
  })

  it('SUPER_ADMIN is allowed through (assertCanAccessPatient resolves) and delegates', async () => {
    const superActor = { id: 'super-1', roles: [UserRole.SUPER_ADMIN] }
    await controller.list(makeReq(superActor), PATIENT)
    expect(access.assertCanAccessPatient).toHaveBeenCalledWith(
      { id: superActor.id, roles: superActor.roles },
      PATIENT,
    )
    expect(caregiver.list).toHaveBeenCalledWith(PATIENT)
  })
})
