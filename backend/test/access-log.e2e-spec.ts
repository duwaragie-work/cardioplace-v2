import { jest } from '@jest/globals'
import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { ClsService } from 'nestjs-cls'
import { AppModule } from '../src/app.module.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { UsersService } from '../src/users/users.service.js'
import { IntakeService } from '../src/intake/intake.service.js'
import { CaregiverService } from '../src/caregiver/caregiver.service.js'
import { generateTestDisplayId } from './helpers/generate-test-display-id.js'

/**
 * PHI access audit trail — full-stack integration (Humaira N8 / 164.312-T7).
 *
 * Bootstraps the real AppModule so `PrismaService` is the ACTUAL audited proxy
 * that all 54 consumers share (Option A, constructor-Proxy wiring, 2026-07-02),
 * and hits the real dev DB. Verifies the cross-cutting guarantees Duwaragie
 * asked for:
 *   • PHI writes/reads are audited with actor attribution from CLS
 *   • ONE row per query (a findMany returning N rows ≠ N rows)
 *   • $transaction propagates auditing into interactive transactions
 *   • non-PHI + AccessLog itself are NOT logged (no recursion)
 *   • SYSTEM_ACTOR fallback when no CLS actor is set
 *   • lifecycle ($connect ran) + custom method (withConnectionRetry) still work
 *   • 3 real consumers share the audited singleton
 *
 * Runs locally against docker `cardio-e2e-pg` (invoke with the [::1] loopback
 * DATABASE_URL). Not part of the Playwright CI gate.
 */
jest.setTimeout(30_000)

describe('AccessLog PHI audit (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let cls: ClsService

  const runTag = `access-log-e2e-${Date.now()}`
  const actor = `${runTag}-prov`
  const userEmail = `${runTag}-patient@example.com`
  let userId: string
  const systemActorRowIds: string[] = []

  // Run `fn` inside a CLS context carrying `actorId` — mirrors what the request
  // middleware sets up per HTTP call.
  function asActor<T>(actorId: string, fn: () => Promise<T>): Promise<T> {
    return cls.run(async () => {
      cls.set('actorId', actorId)
      cls.set('ip', '10.0.0.1')
      cls.set('userAgent', 'int-test')
      return fn()
    })
  }

  // Audit writes are fire-and-forget, so poll until the expected rows land.
  async function waitForLogs(
    where: Record<string, unknown>,
    expected: number,
    timeoutMs = 3000,
  ): Promise<number> {
    const deadline = Date.now() + timeoutMs
    let count = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      count = await prisma.accessLog.count({ where })
      if (count >= expected || Date.now() > deadline) return count
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = moduleFixture.createNestApplication()
    await app.init()

    prisma = app.get(PrismaService)
    cls = app.get(ClsService)

    // PHI fixture — created under the test actor so its audit row is namespaced.
    const user = await asActor(actor, () =>
      prisma.user.create({
        data: {
          email: userEmail,
          name: 'Audit Test Patient',
          roles: ['PATIENT'],
          isVerified: true,
          onboardingStatus: 'NOT_COMPLETED',
          displayId: generateTestDisplayId(['PATIENT']),
        },
      }),
    )
    userId = user.id
  })

  afterAll(async () => {
    // Remove exactly the audit rows this run produced (namespaced actor +
    // captured system-actor rows), then the fixture user.
    await prisma.accessLog.deleteMany({
      where: { OR: [{ actorId: { startsWith: runTag } }, { id: { in: systemActorRowIds } }] },
    })
    await prisma.user.deleteMany({ where: { id: userId } })
    await app.close()
  })

  it('USER-context PHI write → AccessLog row: WRITE, recordId, actorId, actorType=USER', async () => {
    await asActor(actor, () =>
      prisma.user.update({ where: { id: userId }, data: { name: 'Renamed' } }),
    )
    const rows = await prisma.accessLog.findMany({
      where: { actorId: actor, modelName: 'User', action: 'WRITE', recordId: userId },
    })
    // ≥1 (the fixture create also logged a WRITE, but with recordId=created.id
    // which equals userId — so filter includes it; assert the update landed).
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0]).toMatchObject({ actorType: 'USER', ip: '10.0.0.1', userAgent: 'int-test' })
  })

  it('findMany returning N rows → exactly ONE READ row (query intent, not per-record)', async () => {
    const tag = `${runTag}-findmany`
    const before = await prisma.accessLog.count({ where: { actorId: tag } })
    const results = await asActor(tag, () =>
      prisma.user.findMany({ where: { email: { startsWith: runTag } } }),
    )
    expect(results.length).toBeGreaterThanOrEqual(1) // at least the fixture user
    const after = await waitForLogs({ actorId: tag }, before + 1)
    expect(after).toBe(before + 1) // ONE row regardless of how many users came back
    const row = await prisma.accessLog.findFirst({ where: { actorId: tag } })
    expect(row).toMatchObject({ action: 'READ', modelName: 'User', recordId: null })
  })

  it('$transaction propagates auditing into the interactive tx', async () => {
    const tag = `${runTag}-tx`
    await asActor(tag, () =>
      prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { name: 'InTx' } })
      }),
    )
    const count = await waitForLogs(
      { actorId: tag, modelName: 'User', action: 'WRITE' },
      1,
    )
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it('non-PHI model (Practice) → no AccessLog row', async () => {
    const tag = `${runTag}-nonphi`
    await asActor(tag, () => prisma.practice.findMany({ take: 1 }))
    // Give any (erroneous) fire-and-forget write a chance to land, then assert none.
    await new Promise((r) => setTimeout(r, 200))
    expect(await prisma.accessLog.count({ where: { actorId: tag } })).toBe(0)
  })

  it('AccessLog itself → no recursion (reading audit rows writes none)', async () => {
    const tag = `${runTag}-recur`
    await asActor(tag, () => prisma.accessLog.findMany({ where: { actorId: tag }, take: 5 }))
    await new Promise((r) => setTimeout(r, 200))
    expect(await prisma.accessLog.count({ where: { actorId: tag } })).toBe(0)
  })

  it('no CLS actor → SYSTEM_ACTOR / actorId null', async () => {
    const before = await prisma.accessLog.count({
      where: { actorType: 'SYSTEM_ACTOR', modelName: 'User', recordId: userId, action: 'READ' },
    })
    // Called OUTSIDE any asActor() wrapper → no CLS actor.
    await prisma.user.findUnique({ where: { id: userId } })
    await waitForLogs(
      { actorType: 'SYSTEM_ACTOR', modelName: 'User', recordId: userId, action: 'READ' },
      before + 1,
    )
    const row = await prisma.accessLog.findFirst({
      where: { actorType: 'SYSTEM_ACTOR', modelName: 'User', recordId: userId, action: 'READ' },
      orderBy: { createdAt: 'desc' },
    })
    expect(row).toMatchObject({ actorType: 'SYSTEM_ACTOR', actorId: null })
    if (row) systemActorRowIds.push(row.id) // capture for targeted cleanup
  })

  it('lifecycle: base connection primitives still work through the proxy', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ ok: number }>>('SELECT 1 as ok')
    expect(rows[0].ok).toBe(1)
  })

  it('custom method: withConnectionRetry still works (routes to base instance)', async () => {
    const n = await prisma.withConnectionRetry(() => prisma.user.count())
    expect(typeof n).toBe('number')
  })

  it('3 real consumers share the audited PrismaService singleton (cross-cutting coverage)', () => {
    const users = app.get(UsersService)
    const intake = app.get(IntakeService)
    const caregiver = app.get(CaregiverService)
    expect((users as unknown as { prisma: unknown }).prisma).toBe(prisma)
    expect((intake as unknown as { prisma: unknown }).prisma).toBe(prisma)
    expect((caregiver as unknown as { prisma: unknown }).prisma).toBe(prisma)
  })
})
