import { jest } from '@jest/globals'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test, TestingModule } from '@nestjs/testing'
import { ClsService } from 'nestjs-cls'
import request from 'supertest'
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
 *   • a REAL authenticated HTTP request attributes to actorType=USER (regression
 *     guard for the CLS-mounted-as-middleware bug — middleware ran before the
 *     JwtAuthGuard, so req.user was undefined and every request mis-logged as
 *     SYSTEM_ACTOR; fixed by mounting CLS as an interceptor)
 *
 * Runs locally against docker `cardio-e2e-pg` (invoke with the [::1] loopback
 * DATABASE_URL). Not part of the Playwright CI gate.
 */
jest.setTimeout(30_000)

describe('AccessLog PHI audit (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let cls: ClsService
  let jwt: JwtService

  const runTag = `access-log-e2e-${Date.now()}`
  const actor = `${runTag}-prov`
  const userEmail = `${runTag}-patient@example.com`
  let userId: string
  let patientToken: string
  const systemActorRowIds: string[] = []

  // Run `fn` inside a CLS context carrying `actorId` — mirrors what the request
  // interceptor sets up per HTTP call.
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
    // Match main.ts — the ValidationPipe is only applied in bootstrap.
    app.useGlobalPipes(new ValidationPipe({ transform: true }))
    await app.init()

    prisma = app.get(PrismaService)
    cls = app.get(ClsService)
    jwt = app.get(JwtService)

    // PHI fixture — created under the test actor so its audit row is namespaced.
    const user = await asActor(actor, () =>
      prisma.user.create({
        data: {
          email: userEmail,
          name: 'Audit Test Patient',
          roles: ['PATIENT'],
          isVerified: true,
          onboardingStatus: 'COMPLETED',
          displayId: generateTestDisplayId(['PATIENT']),
        },
      }),
    )
    userId = user.id
    patientToken = await jwt.signAsync(
      { sub: user.id, email: user.email, roles: user.roles },
      { expiresIn: '15m' },
    )
  })

  afterAll(async () => {
    // Remove exactly the audit rows this run produced: namespaced test actors,
    // rows attributed to / referencing the fixture user (incl. the guard's
    // SYSTEM_ACTOR User reads, keyed by recordId=userId), and captured rows.
    await prisma.accessLog.deleteMany({
      where: {
        OR: [
          { actorId: { startsWith: runTag } },
          { actorId: userId },
          { recordId: userId },
          { id: { in: systemActorRowIds } },
        ],
      },
    })
    await prisma.profileVerificationLog.deleteMany({ where: { userId } })
    await prisma.patientProfile.deleteMany({ where: { userId } })
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

  // ── Regression guard: real authenticated HTTP request → actorType=USER ──────
  // This is the case my other tests miss: they set CLS manually via asActor().
  // A real request must flow JwtAuthGuard (sets req.user) → ClsInterceptor
  // (reads req.user) → handler → Prisma. If CLS is mounted as MIDDLEWARE it runs
  // before the guard, req.user is undefined, and the handler's PatientProfile
  // write is mis-logged as SYSTEM_ACTOR. Mounted as an interceptor, it's USER.
  // PatientProfile is only touched by the handler here (the guard's validate()
  // reads User, not PatientProfile), so a USER-attributed PatientProfile row is
  // unambiguous proof the actor propagated through the full pipeline.
  it('authenticated POST /intake/profile → PatientProfile audited as USER (not SYSTEM_ACTOR)', async () => {
    // Delta baseline — scope the misattribution check to THIS request so
    // pre-fix leftover rows from earlier runs don't skew it.
    const sysBefore = await prisma.accessLog.count({
      where: { modelName: 'PatientProfile', actorType: 'SYSTEM_ACTOR' },
    })

    const res = await request(app.getHttpServer())
      .post('/intake/profile')
      .set('Authorization', `Bearer ${patientToken}`)
      .set('User-Agent', 'audit-http-test')
      .send({ hasAFib: true })
    expect(res.status).toBe(200)

    await waitForLogs({ modelName: 'PatientProfile', actorId: userId }, 1)
    const row = await prisma.accessLog.findFirst({
      where: { modelName: 'PatientProfile', actorId: userId },
      orderBy: { createdAt: 'desc' },
    })
    expect(row).not.toBeNull()
    expect(row).toMatchObject({ actorType: 'USER', actorId: userId })

    // Crucially: this request added NO SYSTEM_ACTOR PatientProfile row — the
    // handler write propagated the actor through the full guard→interceptor path.
    const sysAfter = await prisma.accessLog.count({
      where: { modelName: 'PatientProfile', actorType: 'SYSTEM_ACTOR' },
    })
    expect(sysAfter).toBe(sysBefore)
  })
})
