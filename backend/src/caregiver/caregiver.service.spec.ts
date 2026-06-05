import { jest } from '@jest/globals'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { CaregiverService } from './caregiver.service.js'

// Gap 5 — CaregiverService CRUD + consent + audit unit coverage.
//   • create stamps consentGivenAt + consentGivenBy only when consentGiven=true
//   • EMAIL channel requires email; SMS requires phone (BadRequest otherwise)
//   • update consent toggle on/off
//   • remove soft-disables (active=false), never hard-deletes
//   • every mutation writes a ProfileVerificationLog audit row
//   • cross-patient access is rejected (NotFound)

function makePrisma() {
  const tx = {
    patientCaregiver: {
      create: jest.fn() as jest.Mock<any>,
      update: jest.fn() as jest.Mock<any>,
    },
    profileVerificationLog: {
      create: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
    },
  }
  const prisma = {
    patientCaregiver: {
      findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      findUnique: jest.fn() as jest.Mock<any>,
    },
    // $transaction invokes the callback with the tx stub.
    $transaction: (jest.fn() as jest.Mock<any>).mockImplementation(
      async (cb: any) => cb(tx),
    ),
  }
  return { prisma, tx }
}

function row(over: Record<string, any> = {}) {
  return {
    id: 'cg-1',
    patientUserId: 'patient-1',
    name: 'Dana',
    relationship: null,
    phone: null,
    email: 'dana@example.com',
    notifyChannel: 'EMAIL',
    consentGivenAt: null,
    consentGivenBy: null,
    caregiverUserId: null,
    active: true,
    createdAt: new Date('2026-05-20T00:00:00Z'),
    updatedAt: new Date('2026-05-20T00:00:00Z'),
    ...over,
  }
}

describe('CaregiverService', () => {
  it('create stamps consent when consentGiven=true + writes audit', async () => {
    const { prisma, tx } = makePrisma()
    tx.patientCaregiver.create.mockResolvedValue(
      row({ consentGivenAt: new Date(), consentGivenBy: 'patient-1' }),
    )
    const svc = new CaregiverService(prisma as any)

    const out = await svc.create('patient-1', 'patient-1', 'PATIENT', {
      name: 'Dana',
      email: 'dana@example.com',
      notifyChannel: 'EMAIL',
      consentGiven: true,
    })

    const data = tx.patientCaregiver.create.mock.calls[0][0].data
    expect(data.consentGivenAt).toBeInstanceOf(Date)
    expect(data.consentGivenBy).toBe('patient-1')
    expect(tx.profileVerificationLog.create).toHaveBeenCalledTimes(1)
    expect(out.data.consentGivenAt).not.toBeNull()
  })

  it('create leaves consent null when consentGiven is absent', async () => {
    const { prisma, tx } = makePrisma()
    tx.patientCaregiver.create.mockResolvedValue(row())
    const svc = new CaregiverService(prisma as any)

    await svc.create('patient-1', 'patient-1', 'PATIENT', {
      name: 'Dana',
      email: 'dana@example.com',
      notifyChannel: 'EMAIL',
    })

    const data = tx.patientCaregiver.create.mock.calls[0][0].data
    expect(data.consentGivenAt).toBeNull()
    expect(data.consentGivenBy).toBeNull()
  })

  it('rejects EMAIL channel without an email', async () => {
    const { prisma } = makePrisma()
    const svc = new CaregiverService(prisma as any)
    await expect(
      svc.create('patient-1', 'patient-1', 'PATIENT', {
        name: 'Dana',
        notifyChannel: 'EMAIL',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects SMS channel without a phone', async () => {
    const { prisma } = makePrisma()
    const svc = new CaregiverService(prisma as any)
    await expect(
      svc.create('patient-1', 'patient-1', 'PATIENT', {
        name: 'Dana',
        notifyChannel: 'SMS',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('update toggles consent on (stamps) when previously null', async () => {
    const { prisma, tx } = makePrisma()
    prisma.patientCaregiver.findUnique.mockResolvedValue(row())
    tx.patientCaregiver.update.mockResolvedValue(
      row({ consentGivenAt: new Date(), consentGivenBy: 'admin-1' }),
    )
    const svc = new CaregiverService(prisma as any)

    await svc.update('patient-1', 'cg-1', 'admin-1', 'ADMIN', { consentGiven: true })

    const data = tx.patientCaregiver.update.mock.calls[0][0].data
    expect(data.consentGivenAt).toBeInstanceOf(Date)
    expect(data.consentGivenBy).toBe('admin-1')
  })

  it('update toggles consent off (clears stamp)', async () => {
    const { prisma, tx } = makePrisma()
    prisma.patientCaregiver.findUnique.mockResolvedValue(
      row({ consentGivenAt: new Date(), consentGivenBy: 'patient-1' }),
    )
    tx.patientCaregiver.update.mockResolvedValue(row())
    const svc = new CaregiverService(prisma as any)

    await svc.update('patient-1', 'cg-1', 'patient-1', 'PATIENT', { consentGiven: false })

    const data = tx.patientCaregiver.update.mock.calls[0][0].data
    expect(data.consentGivenAt).toBeNull()
    expect(data.consentGivenBy).toBeNull()
  })

  it('remove soft-disables (active=false), does not delete', async () => {
    const { prisma, tx } = makePrisma()
    prisma.patientCaregiver.findUnique.mockResolvedValue(row())
    tx.patientCaregiver.update.mockResolvedValue(row({ active: false }))
    const svc = new CaregiverService(prisma as any)

    const out = await svc.remove('patient-1', 'cg-1', 'patient-1', 'PATIENT')

    expect(tx.patientCaregiver.update.mock.calls[0][0].data).toEqual({ active: false })
    expect(out.data.active).toBe(false)
    expect(tx.profileVerificationLog.create).toHaveBeenCalledTimes(1)
  })

  it('rejects access to another patient’s caregiver', async () => {
    const { prisma } = makePrisma()
    prisma.patientCaregiver.findUnique.mockResolvedValue(
      row({ patientUserId: 'someone-else' }),
    )
    const svc = new CaregiverService(prisma as any)
    await expect(
      svc.update('patient-1', 'cg-1', 'patient-1', 'PATIENT', { name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
