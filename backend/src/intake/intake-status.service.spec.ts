import { jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import { IntakeStatusService } from './intake-status.service.js'
import { PrismaService } from '../prisma/prisma.service.js'

describe('IntakeStatusService', () => {
  let svc: IntakeStatusService
  let findUnique: jest.Mock

  beforeEach(async () => {
    findUnique = jest.fn() as jest.Mock
    const moduleRef = await Test.createTestingModule({
      providers: [
        IntakeStatusService,
        {
          provide: PrismaService,
          useValue: { patientProfile: { findUnique } },
        },
      ],
    }).compile()
    svc = moduleRef.get(IntakeStatusService)
  })

  it('returns completed=false when no PatientProfile exists for the user', async () => {
    findUnique.mockResolvedValue(null as never)
    const status = await svc.getStatus('user-A')
    expect(status).toEqual({ completed: false, profileExists: false })
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-A' },
      select: { userId: true },
    })
  })

  it('returns completed=true when a PatientProfile row exists', async () => {
    findUnique.mockResolvedValue({ userId: 'user-A' } as never)
    const status = await svc.getStatus('user-A')
    expect(status).toEqual({ completed: true, profileExists: true })
  })

  it('scopes the lookup to the supplied userId only (no cross-tenant leak)', async () => {
    findUnique.mockResolvedValue({ userId: 'user-A' } as never)
    await svc.getStatus('user-A')
    const arg = findUnique.mock.calls[0][0] as { where: { userId: string } }
    expect(arg.where.userId).toBe('user-A')
    // Asserting we use findUnique (PK-scoped) rather than findFirst with a
    // loose where clause — guards against accidental scope widening.
    expect(findUnique).toHaveBeenCalledTimes(1)
  })
})
