import { jest } from '@jest/globals'
import { AccessLogReadService } from './access-log-read.service.js'

function makeService() {
  const accessLog = {
    findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
    count: (jest.fn() as jest.Mock<any>).mockResolvedValue(0),
  }
  const authLog = {
    findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
    count: (jest.fn() as jest.Mock<any>).mockResolvedValue(0),
  }
  const prisma = { accessLog, authLog } as any
  const service = new AccessLogReadService(prisma)
  return { service, accessLog, authLog }
}

describe('AccessLogReadService', () => {
  describe('listAccessLogs', () => {
    it('defaults to page 1 / limit 50, empty where, newest first', async () => {
      const { service, accessLog } = makeService()
      ;(accessLog.count as jest.Mock<any>).mockResolvedValue(3)
      ;(accessLog.findMany as jest.Mock<any>).mockResolvedValue([{ id: 'a1' }])

      const res = await service.listAccessLogs({})

      expect(accessLog.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 50,
        orderBy: { createdAt: 'desc' },
      })
      expect(res).toEqual({ data: [{ id: 'a1' }], total: 3, page: 1, limit: 50 })
    })

    it('builds actor / action / model / record filters + time window, and paginates', async () => {
      const { service, accessLog } = makeService()

      await service.listAccessLogs({
        actorId: 'u1',
        actorType: 'USER',
        action: 'DELETE',
        modelName: 'JournalEntry',
        recordId: 'e1',
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-06T00:00:00.000Z',
        page: 2,
        limit: 10,
      })

      expect(accessLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
          where: {
            actorId: 'u1',
            actorType: 'USER',
            action: 'DELETE',
            modelName: 'JournalEntry',
            recordId: 'e1',
            createdAt: {
              gte: new Date('2026-07-01T00:00:00.000Z'),
              lte: new Date('2026-07-06T00:00:00.000Z'),
            },
          },
        }),
      )
    })

    it('supports an open-ended (from-only) time window', async () => {
      const { service, accessLog } = makeService()
      await service.listAccessLogs({ from: '2026-07-01T00:00:00.000Z' })
      expect(accessLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { createdAt: { gte: new Date('2026-07-01T00:00:00.000Z') } },
        }),
      )
    })
  })

  describe('listAuthLogs', () => {
    it('parses the success outcome flag and filters by event / practiceContext', async () => {
      const { service, authLog } = makeService()

      await service.listAuthLogs({
        event: 'login',
        success: 'false',
        practiceContext: 'p1',
      })

      expect(authLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            event: 'login',
            success: false,
            practiceContext: 'p1',
          }),
        }),
      )
    })

    it('matches identifier case-insensitively (contains)', async () => {
      const { service, authLog } = makeService()
      await service.listAuthLogs({ identifier: 'aBc' })
      expect(authLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { identifier: { contains: 'aBc', mode: 'insensitive' } },
        }),
      )
    })

    it('treats success:"true" as a boolean true filter', async () => {
      const { service, authLog } = makeService()
      await service.listAuthLogs({ success: 'true' })
      expect(authLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { success: true } }),
      )
    })
  })
})
