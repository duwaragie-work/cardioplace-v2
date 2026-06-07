import { jest } from '@jest/globals'
import { ProviderService } from './provider.service.js'

// F1: getPatientBpTrend must include the current/boundary local day. The end
// date arrives as a calendar date ("2026-06-01"); a naive `lte: new Date(endDate)`
// parses to UTC midnight and excludes everything taken during that day.
describe('ProviderService.getPatientBpTrend (F1 boundary day)', () => {
  function makeService() {
    let capturedWhere: any
    const prisma = {
      journalEntry: {
        findMany: jest.fn(async (args: any) => {
          capturedWhere = args.where
          return []
        }),
      },
    }
    const service = new ProviderService(
      prisma as any,
      {} as any,
      {} as any,
    )
    return { service, prisma, getWhere: () => capturedWhere }
  }

  it('extends the upper bound to end-of-day so a same-day reading is included', async () => {
    const { service, getWhere } = makeService()
    const startDate = '2026-05-01'
    const endDate = '2026-06-01'

    await service.getPatientBpTrend('user-1', startDate, endDate)

    const where = getWhere()
    const lte: Date = where.measuredAt.lte
    const gte: Date = where.measuredAt.gte

    // A reading taken during the end day (afternoon UTC) must fall within range.
    const sameDayReading = new Date(`${endDate}T15:00:00.000Z`)
    expect(sameDayReading.getTime()).toBeLessThanOrEqual(lte.getTime())
    expect(sameDayReading.getTime()).toBeGreaterThanOrEqual(gte.getTime())

    // And the upper bound is the very end of the end day, not its midnight.
    expect(lte.getTime()).toBe(new Date(`${endDate}T23:59:59.999Z`).getTime())
  })

  it('regression: a naive midnight bound would have excluded the same-day reading', async () => {
    const endDate = '2026-06-01'
    const naiveLte = new Date(endDate) // UTC midnight — the old buggy bound
    const sameDayReading = new Date(`${endDate}T15:00:00.000Z`)
    expect(sameDayReading.getTime()).toBeGreaterThan(naiveLte.getTime())
  })
})
