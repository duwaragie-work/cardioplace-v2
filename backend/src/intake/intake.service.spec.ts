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
