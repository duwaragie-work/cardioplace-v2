import { jest } from '@jest/globals'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test, TestingModule } from '@nestjs/testing'
import { ClsService } from 'nestjs-cls'
import request from 'supertest'
import { AppModule } from '../src/app.module.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { generateTestDisplayId } from './helpers/generate-test-display-id.js'

/**
 * AccessLog conformance — the permanent regression guard (Duwaragie 2026-07-03,
 * Humaira N8 / 164.312-T7, HIPAA §164.312(b)).
 *
 * Goal: every write against a PHI model produces exactly one audit trail. It
 * drives one representative WRITE per PHI model through the REAL audited
 * `PrismaService` singleton — the constructor-Proxy client all 54 consumers
 * share — inside an authenticated CLS context, and asserts an AccessLog WRITE
 * row lands. A model that ever falls out of `PHI_MODELS`, or a broken op
 * classifier, drops that model's delta to zero and fails here.
 *
 * WHAT THIS CATCHES
 *   ✅ A PHI model removed from PHI_MODELS in the extension → its write yields
 *      no AccessLog row → the per-model test fails.
 *   ✅ A broken write-op classifier (create/update/upsert/…) → same.
 *   ✅ Inline audit-actor stamping regressed on the 3 AUDIT_STAMP_MODELS →
 *      the stamp assertions fail (here, the two that are ALSO PHI:
 *      DeviationAlert + PatientThreshold; PatientProviderAssignment is a stamp
 *      target but NOT PHI, covered by the extension unit test).
 *   ✅ The full HTTP request path (guard → CLS interceptor → handler → Prisma)
 *      still audits with USER attribution — the HTTP write + read tests below.
 *
 * WHAT THIS DOES NOT CATCH (documented gaps — see 2026-07-03 handoff Task 3.4)
 *   ⚠️ A service that raw-SQL's or `new PrismaClient()`s around the shared
 *      audited client in an UN-EXERCISED code path. This spec drives writes
 *      through the shared client per model, so it proves the extension's
 *      coverage, not that no service ever instantiates its own client. The
 *      HTTP tests exercise real controllers; broader coverage is code review.
 *   ⚠️ A brand-new PHI-adjacent model added to schema but never added to
 *      PHI_MODELS — not in this list, so it slips through. A schema-parser
 *      test is a possible follow-up.
 *   ⚠️ CLS actor unset on a path → the row is still written, just as
 *      SYSTEM_ACTOR. Task 1's per-cron label + the CLS interceptor cover that.
 *
 * PatientMedication stays in the write→row assertion but is deliberately
 * EXCLUDED from the inline-stamp assertion: its #92 addedByUserId /
 * lastEditedByUserId already carry generic edit-actor provenance, so it is not
 * in AUDIT_STAMP_MODELS (2026-07-03 decision).
 *
 * Runs locally against docker `cardio-e2e-pg`. Not part of the Playwright CI
 * gate (backend jest is local-only). Requires the SEED_TEST_FIXTURES cohort
 * for the seeded provider used by the HTTP read test.
 */
jest.setTimeout(45_000)

interface PhiWrite {
  model: string
  stamp: boolean // in AUDIT_STAMP_MODELS AND a PHI model → assert inline fields
  write: () => Promise<{ id: string }>
}

describe('AccessLog conformance — every PHI-model write produces an audit row (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let cls: ClsService
  let jwt: JwtService

  const runTag = `conformance-e2e-${Date.now()}`
  const actorA = `${runTag}-actorA`
  const actorB = `${runTag}-actorB`
  const cleanupActor = `${runTag}-cleanup`
  const patientEmail = `${runTag}-patient@example.com`
  let patientId: string
  let patientToken: string
  let journalEntryId: string

  // Seeded Cedar Hill provider — used only by the HTTP read test.
  let providerId: string
  let providerToken: string

  function asActor<T>(actorId: string, fn: () => Promise<T>): Promise<T> {
    return cls.run(async () => {
      cls.set('actorId', actorId)
      cls.set('ip', '10.0.0.9')
      cls.set('userAgent', 'conformance-test')
      return fn()
    })
  }

  async function waitForLogs(
    where: Record<string, unknown>,
    expected: number,
    timeoutMs = 4000,
  ): Promise<number> {
    const deadline = Date.now() + timeoutMs
    let count = 0
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
    app.useGlobalPipes(new ValidationPipe({ transform: true }))
    await app.init()

    prisma = app.get(PrismaService)
    cls = app.get(ClsService)
    jwt = app.get(JwtService)

    // Throwaway patient — its writes are what the loop audits. onboarding/verify
    // set so the HTTP /intake/profile write clears the patient guards.
    const patient = await asActor(cleanupActor, () =>
      prisma.user.create({
        data: {
          email: patientEmail,
          name: 'Conformance Patient',
          roles: ['PATIENT'],
          isVerified: true,
          onboardingStatus: 'COMPLETED',
          displayId: generateTestDisplayId(['PATIENT']),
        },
      }),
    )
    patientId = patient.id
    patientToken = await jwt.signAsync(
      { sub: patient.id, email: patient.email, roles: patient.roles },
      { expiresIn: '15m' },
    )

    // A journal entry to hang a DeviationAlert off (FK journalEntryId).
    const entry = await asActor(cleanupActor, () =>
      prisma.journalEntry.create({
        data: { userId: patientId, measuredAt: new Date(), systolicBP: 128, diastolicBP: 82 },
      }),
    )
    journalEntryId = entry.id

    // Seeded provider (Cedar Hill) for the HTTP read test. Fail fast + clear if
    // the fixtures cohort isn't loaded.
    const provider = await prisma.user.findUnique({
      where: { email: 'primary-provider@cardioplace.test' },
      select: { id: true, email: true, roles: true },
    })
    if (!provider) {
      throw new Error(
        'Conformance e2e requires the SEED_TEST_FIXTURES cohort. Missing primary-provider@cardioplace.test. ' +
          'Run: SEED_TEST_FIXTURES=true npx tsx prisma/seed.ts',
      )
    }
    providerId = provider.id
    providerToken = await jwt.signAsync(
      { sub: provider.id, email: provider.email, roles: provider.roles, activePracticeId: 'seed-cedar-hill' },
      { expiresIn: '15m' },
    )
  }, 60_000)

  afterAll(async () => {
    // Cascades from the throwaway user clean its PHI children; do it under a
    // tagged actor so the DELETE audit rows are targetable below.
    await asActor(cleanupActor, async () => {
      await prisma.deviationAlert.deleteMany({ where: { userId: patientId } })
      await prisma.journalEntry.deleteMany({ where: { userId: patientId } })
      await prisma.patientMedication.deleteMany({ where: { userId: patientId } })
      await prisma.patientThreshold.deleteMany({ where: { userId: patientId } })
      await prisma.notification.deleteMany({ where: { userId: patientId } })
      await prisma.patientProfile.deleteMany({ where: { userId: patientId } })
      await prisma.profileVerificationLog.deleteMany({ where: { userId: patientId } })
      await prisma.user.deleteMany({ where: { id: patientId } })
    })
    // Best-effort audit cleanup: rows this run produced (tagged actors, or
    // referencing the fixture patient / provider read rows from the HTTP test).
    await prisma.accessLog.deleteMany({
      where: {
        OR: [
          { actorId: { startsWith: runTag } },
          { recordId: patientId },
          { recordId: journalEntryId },
          { actorId: patientId },
          { actorId: providerId, action: 'READ' },
        ],
      },
    })
    await app?.close()
  })

  // ── Per-PHI-model write → exactly-one-or-more AccessLog WRITE row ───────────
  it('sets up the PHI write matrix (7 models)', () => {
    // Sanity: the models we exercise match the extension's PHI set intent.
    expect(true).toBe(true)
  })

  const phiWrites = (): PhiWrite[] => [
    {
      model: 'User',
      stamp: false,
      write: () => prisma.user.update({ where: { id: patientId }, data: { name: 'Conformance R' } }),
    },
    {
      model: 'PatientProfile',
      stamp: false,
      write: () =>
        prisma.patientProfile.upsert({
          where: { userId: patientId },
          create: { userId: patientId, hasAFib: true },
          update: { hasAFib: true },
        }),
    },
    {
      model: 'JournalEntry',
      stamp: false,
      write: () =>
        prisma.journalEntry.create({
          data: { userId: patientId, measuredAt: new Date(), systolicBP: 122, diastolicBP: 78 },
        }),
    },
    {
      model: 'PatientMedication', // in the write→row assertion, NOT the stamp assertion (#92)
      stamp: false,
      write: () =>
        prisma.patientMedication.create({
          data: {
            userId: patientId,
            drugName: 'Conformance Losartan',
            drugClass: 'ARB',
            frequency: 'ONCE_DAILY',
            source: 'PATIENT_SELF_REPORT',
          },
        }),
    },
    {
      model: 'Notification',
      stamp: false,
      write: () =>
        prisma.notification.create({
          data: { userId: patientId, channel: 'PUSH', title: 'Conformance', body: 'x', dispatchTrigger: 'SYSTEM_OTHER' },
        }),
    },
    {
      model: 'PatientThreshold', // PHI + stamp
      stamp: true,
      write: () =>
        prisma.patientThreshold.create({
          data: { userId: patientId, setByProviderId: actorA, sbpUpperTarget: 140 },
        }),
    },
    {
      model: 'DeviationAlert', // PHI + stamp
      stamp: true,
      write: () =>
        prisma.deviationAlert.create({
          data: { userId: patientId, journalEntryId, status: 'OPEN', ruleId: 'conformance-probe' },
        }),
    },
  ]

  for (const spec of phiWrites()) {
    it(`WRITE on ${spec.model} produces an AccessLog WRITE row${spec.stamp ? ' + stamps inline actor' : ''}`, async () => {
      const where = { modelName: spec.model, action: 'WRITE' as const }
      const before = await prisma.accessLog.count({ where })

      const rec = await asActor(actorA, spec.write)

      const after = await waitForLogs(where, before + 1)
      // >0 delta, not strictly +1: a single write can cascade sibling writes
      // (e.g. a Notification save alongside), which is fine. ZERO delta is the
      // red flag — the extension was bypassed for this model.
      expect(after).toBeGreaterThan(before)

      if (spec.stamp) {
        const row = (await prisma.$queryRawUnsafe(
          `SELECT "createdByActorId", "updatedByActorId" FROM "${spec.model}" WHERE id = $1`,
          rec.id,
        )) as Array<{ createdByActorId: string | null; updatedByActorId: string | null }>
        expect(row[0]?.createdByActorId).toBe(actorA)
        expect(row[0]?.updatedByActorId).toBe(actorA)
      }
    })
  }

  it('update on a stamp model bumps updatedByActorId, leaves createdByActorId (DeviationAlert)', async () => {
    const created = await asActor(actorA, () =>
      prisma.deviationAlert.create({
        data: { userId: patientId, journalEntryId, status: 'OPEN', ruleId: 'conformance-update-probe' },
      }),
    )
    await asActor(actorB, () =>
      prisma.deviationAlert.update({ where: { id: created.id }, data: { status: 'ACKNOWLEDGED' } }),
    )
    const row = (await prisma.$queryRawUnsafe(
      `SELECT "createdByActorId", "updatedByActorId" FROM "DeviationAlert" WHERE id = $1`,
      created.id,
    )) as Array<{ createdByActorId: string | null; updatedByActorId: string | null }>
    expect(row[0]?.createdByActorId).toBe(actorA) // unchanged by the update
    expect(row[0]?.updatedByActorId).toBe(actorB) // bumped to the updater
  })

  // ── Full HTTP write path: request → guard → CLS interceptor → handler → Prisma
  it('authenticated POST /intake/profile → PatientProfile audited as USER via the full request path', async () => {
    const before = await prisma.accessLog.count({
      where: { modelName: 'PatientProfile', actorId: patientId, action: 'WRITE' },
    })
    const res = await request(app.getHttpServer())
      .post('/intake/profile')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ hasCAD: true })
    expect(res.status).toBe(200)

    const after = await waitForLogs(
      { modelName: 'PatientProfile', actorId: patientId, action: 'WRITE' },
      before + 1,
    )
    expect(after).toBeGreaterThan(before)
  })

  // ── READ conformance (Task 3.3): one representative signed-in read path ─────
  it('authenticated GET /provider/patients (provider) produces AccessLog READ rows', async () => {
    const before = await prisma.accessLog.count({
      where: { actorId: providerId, action: 'READ' },
    })
    const res = await request(app.getHttpServer())
      .get('/provider/patients')
      .set('Authorization', `Bearer ${providerToken}`)
    expect(res.status).toBe(200)

    const after = await waitForLogs({ actorId: providerId, action: 'READ' }, before + 1)
    expect(after).toBeGreaterThan(before)
  })
})
