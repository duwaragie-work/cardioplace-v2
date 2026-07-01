import { jest } from '@jest/globals'
import { ProviderService } from './provider.service.js'
import { UserRole } from '../generated/prisma/enums.js'

// Manisha 2026-06 / Humaira HIPAA N14 — the dashboard alert queue
// (GET /provider/alerts, which also feeds /admin/notifications) is the
// provider's focused work list, not the whole practice. getAlerts must scope
// via PatientAccessService.alertQueueScopeFilter (assigned-only for a plain
// PROVIDER), NOT patientScopeFilter (practice-wide). These pure-unit tests
// lock that wiring in without a DB.

function makeService(scopeFragment: unknown) {
  const alertQueueScopeFilter = (jest.fn() as jest.Mock<any>).mockResolvedValue(
    scopeFragment,
  )
  // If getAlerts ever reverts to the practice-wide filter, this spy firing is
  // the tripwire.
  const patientScopeFilter = (jest.fn() as jest.Mock<any>).mockResolvedValue({
    providerAssignmentAsPatient: { is: { practiceId: { in: ['practice-a'] } } },
  })
  const findMany = (jest.fn() as jest.Mock<any>).mockResolvedValue([])
  const prisma = {
    deviationAlert: { findMany },
    scheduledCall: { findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]) },
    user: { findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]) },
  }
  const access = { alertQueueScopeFilter, patientScopeFilter }
  const svc = new ProviderService(prisma as any, {} as any, access as any)
  return { svc, findMany, alertQueueScopeFilter, patientScopeFilter }
}

describe('getAlerts — dashboard queue scoping', () => {
  it('scopes the query via alertQueueScopeFilter, NOT patientScopeFilter', async () => {
    const fragment = {
      providerAssignmentAsPatient: {
        is: {
          OR: [{ primaryProviderId: 'prov-1' }, { backupProviderId: 'prov-1' }],
          practiceId: { in: ['practice-a'] },
        },
      },
    }
    const { svc, findMany, alertQueueScopeFilter, patientScopeFilter } =
      makeService(fragment)

    await svc.getAlerts({
      actor: { id: 'prov-1', roles: [UserRole.PROVIDER] },
    })

    expect(alertQueueScopeFilter).toHaveBeenCalledTimes(1)
    expect(patientScopeFilter).not.toHaveBeenCalled()
    // The assigned-only fragment must be nested under `where.user.is` so the
    // Alert→patient join filters the queue.
    const where = findMany.mock.calls[0][0].where
    expect(where.user).toEqual({ is: fragment })
    expect(where.status).toBe('OPEN')
  })

  it('applies no user scope when the filter returns undefined (org-wide roles)', async () => {
    const { svc, findMany } = makeService(undefined)

    await svc.getAlerts({
      actor: { id: 'super-1', roles: [UserRole.SUPER_ADMIN] },
    })

    const where = findMany.mock.calls[0][0].where
    expect(where.user).toBeUndefined()
  })
})
