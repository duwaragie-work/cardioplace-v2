import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { generateTestDisplayId } from './helpers/generate-test-display-id.js'

// 2026-07-01 access-scope patch (see docs/ACCESS_SCOPE.md §2.1 / §3.2 / §6 / §8):
//   • MED_DIR gains practice-scoped admin authority (roster + config +
//     staff-membership) for practices they HEAD — 403 outside.
//   • MED_DIR stays blocked from org-level actions (permanent-close, practice
//     create/delete).
//   • COORDINATOR walkbacks: no care-team assignment (#116), no permanent-close
//     (#114). Reversible deactivate/invite/list stay.
//
// Same strategy as practice.e2e-spec: real Prisma Postgres DB, per-run tag,
// hand-minted JWTs, clean up exactly what we create.
describe('RBAC access-scope 2026-07-01 (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let jwt: JwtService

  const runTag = `rbac-scope-e2e-${Date.now()}`

  // Two practices — Cedar Hill (A, headed by medA) and BridgePoint (B).
  let practiceAId: string
  let practiceBId: string

  const email = (slug: string) => `${runTag}-${slug}@example.com`

  // Actors
  let medAId: string // MED_DIR heading practice A
  let coordAId: string // COORDINATOR of practice A
  let opsId: string
  let superId: string
  // Targets
  let provAId: string // PROVIDER, member of practice A
  let provA2Id: string // PROVIDER, member of practice A (deactivate target)
  let provBId: string // PROVIDER, member of practice B (cross-practice target)
  let patientAId: string // PATIENT assigned to practice A
  let patientCoordTargetId: string // PATIENT in practice A (coord deactivate target)
  let unassignedProviderId: string // PROVIDER with no membership (staff-add target)

  let medAToken: string
  let coordAToken: string
  let opsToken: string
  let superToken: string

  const allEmails = [
    'medA', 'coordA', 'ops', 'super', 'provA', 'provA2', 'provB',
    'patientA', 'patientCoordTarget', 'unassignedProvider',
  ].map(email)

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: { email: { in: allEmails } },
      select: { id: true },
    })
    const ids = users.map((u) => u.id)
    // Invites created by the invite tests (emailed to runTag-prefixed addresses).
    await prisma.userInvite.deleteMany({
      where: { email: { startsWith: runTag } },
    })
    if (ids.length) {
      await prisma.profileVerificationLog.deleteMany({ where: { userId: { in: ids } } })
      await prisma.patientProviderAssignment.deleteMany({ where: { userId: { in: ids } } })
      await prisma.practiceProvider.deleteMany({ where: { userId: { in: ids } } })
      await prisma.practiceMedicalDirector.deleteMany({ where: { userId: { in: ids } } })
      await prisma.practiceCoordinator.deleteMany({ where: { userId: { in: ids } } })
      await prisma.user.deleteMany({ where: { id: { in: ids } } })
    }
    await prisma.practice.deleteMany({ where: { name: { startsWith: runTag } } })
  }

  async function mkUser(slug: string, roles: string[]) {
    return prisma.user.create({
      data: {
        email: email(slug),
        name: slug,
        roles: roles as never,
        isVerified: true,
        onboardingStatus: roles.includes('PATIENT') ? 'NOT_COMPLETED' : 'COMPLETED',
        displayId: generateTestDisplayId(roles),
      },
    })
  }

  const sign = (id: string, mail: string, roles: string[]) =>
    jwt.signAsync({ sub: id, email: mail, roles }, { expiresIn: '15m' })

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = moduleFixture.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ transform: true }))
    prisma = moduleFixture.get(PrismaService)
    jwt = moduleFixture.get(JwtService)
    await app.init()
    await cleanup()

    const [practiceA, practiceB] = await Promise.all([
      prisma.practice.create({
        data: {
          name: `${runTag}-cedar-hill`,
          businessHoursStart: '08:00',
          businessHoursEnd: '18:00',
          businessHoursTimezone: 'America/New_York',
        },
      }),
      prisma.practice.create({
        data: {
          name: `${runTag}-bridgepoint`,
          businessHoursStart: '08:00',
          businessHoursEnd: '18:00',
          businessHoursTimezone: 'America/New_York',
        },
      }),
    ])
    practiceAId = practiceA.id
    practiceBId = practiceB.id

    const [medA, coordA, ops, superU, provA, provA2, provB, patientA, patientCoordTarget, unassignedProvider] =
      await Promise.all([
        mkUser('medA', ['MEDICAL_DIRECTOR']),
        mkUser('coordA', ['COORDINATOR']),
        mkUser('ops', ['HEALPLACE_OPS']),
        mkUser('super', ['SUPER_ADMIN']),
        mkUser('provA', ['PROVIDER']),
        mkUser('provA2', ['PROVIDER']),
        mkUser('provB', ['PROVIDER']),
        mkUser('patientA', ['PATIENT']),
        mkUser('patientCoordTarget', ['PATIENT']),
        mkUser('unassignedProvider', ['PROVIDER']),
      ])
    medAId = medA.id
    coordAId = coordA.id
    opsId = ops.id
    superId = superU.id
    provAId = provA.id
    provA2Id = provA2.id
    provBId = provB.id
    patientAId = patientA.id
    patientCoordTargetId = patientCoordTarget.id
    unassignedProviderId = unassignedProvider.id

    // Memberships.
    await Promise.all([
      prisma.practiceMedicalDirector.create({ data: { practiceId: practiceAId, userId: medAId } }),
      prisma.practiceCoordinator.create({ data: { practiceId: practiceAId, userId: coordAId } }),
      prisma.practiceProvider.create({ data: { practiceId: practiceAId, userId: provAId } }),
      prisma.practiceProvider.create({ data: { practiceId: practiceAId, userId: provA2Id } }),
      prisma.practiceProvider.create({ data: { practiceId: practiceBId, userId: provBId } }),
    ])
    // Care-team assignments (patients belong to practice A).
    await Promise.all([
      prisma.patientProviderAssignment.create({
        data: {
          userId: patientAId,
          practiceId: practiceAId,
          primaryProviderId: provAId,
          backupProviderId: provA2Id,
          medicalDirectorId: medAId,
        },
      }),
      prisma.patientProviderAssignment.create({
        data: {
          userId: patientCoordTargetId,
          practiceId: practiceAId,
          primaryProviderId: provAId,
          backupProviderId: provA2Id,
          medicalDirectorId: medAId,
        },
      }),
    ])

    ;[medAToken, coordAToken, opsToken, superToken] = await Promise.all([
      sign(medAId, medA.email!, medA.roles),
      sign(coordAId, coordA.email!, coordA.roles),
      sign(opsId, ops.email!, ops.roles),
      sign(superId, superU.email!, superU.roles),
    ])
  }, 45000)

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  const srv = () => app.getHttpServer()

  // ─── MED_DIR positive — roster ───────────────────────────────────────────
  describe('MED_DIR roster authority (practice-scoped)', () => {
    it('GET /admin/users is scoped to headed practice (no BridgePoint staff)', async () => {
      const res = await request(srv())
        .get('/admin/users')
        .set('Authorization', `Bearer ${medAToken}`)
        .expect(200)
      const emails: string[] = res.body.data.map((u: { email: string }) => u.email)
      expect(emails).toContain(email('provA'))
      expect(emails).not.toContain(email('provB'))
    })

    it('can invite a PROVIDER into the practice they head (201)', async () => {
      await request(srv())
        .post('/admin/users/invite')
        .set('Authorization', `Bearer ${medAToken}`)
        .send({ email: email('invitee-a'), name: 'Invitee A', role: 'PROVIDER', practiceId: practiceAId })
        .expect(201)
    })

    it('cannot invite into a practice they do NOT head (403)', async () => {
      await request(srv())
        .post('/admin/users/invite')
        .set('Authorization', `Bearer ${medAToken}`)
        .send({ email: email('invitee-b'), name: 'Invitee B', role: 'PROVIDER', practiceId: practiceBId })
        .expect(403)
    })

    it('can deactivate a provider in their practice (200/201)', async () => {
      const res = await request(srv())
        .post(`/admin/users/${provA2Id}/deactivate`)
        .set('Authorization', `Bearer ${medAToken}`)
        .send({ reason: 'test' })
      expect([200, 201]).toContain(res.status)
    })

    it('cannot deactivate a provider in another practice (403)', async () => {
      await request(srv())
        .post(`/admin/users/${provBId}/deactivate`)
        .set('Authorization', `Bearer ${medAToken}`)
        .send({ reason: 'test' })
        .expect(403)
    })
  })

  // ─── MED_DIR positive — practice config + staff membership ───────────────
  describe('MED_DIR practice authority (practice-scoped)', () => {
    it('can PATCH config of a practice they head (200)', async () => {
      await request(srv())
        .patch(`/admin/practices/${practiceAId}`)
        .set('Authorization', `Bearer ${medAToken}`)
        .send({ businessHoursEnd: '19:00' })
        .expect(200)
    })

    it('cannot PATCH config of a practice they do not head (403)', async () => {
      await request(srv())
        .patch(`/admin/practices/${practiceBId}`)
        .set('Authorization', `Bearer ${medAToken}`)
        .send({ businessHoursEnd: '19:00' })
        .expect(403)
    })

    it('can add a provider to a practice they head (200)', async () => {
      await request(srv())
        .post(`/admin/practices/${practiceAId}/providers/${unassignedProviderId}`)
        .set('Authorization', `Bearer ${medAToken}`)
        .expect(200)
    })

    it('cannot add staff to a practice they do not head (403)', async () => {
      await request(srv())
        .post(`/admin/practices/${practiceBId}/providers/${unassignedProviderId}`)
        .set('Authorization', `Bearer ${medAToken}`)
        .expect(403)
    })
  })

  // ─── MED_DIR negative — org-level ────────────────────────────────────────
  describe('MED_DIR blocked from org-level actions', () => {
    it('cannot permanent-close a user (403)', async () => {
      await request(srv())
        .post(`/admin/users/${provAId}/permanent-close`)
        .set('Authorization', `Bearer ${medAToken}`)
        .send({ confirmDisplayId: 'whatever', reason: 'x' })
        .expect(403)
    })

    it('cannot create a practice (403)', async () => {
      await request(srv())
        .post('/admin/practices')
        .set('Authorization', `Bearer ${medAToken}`)
        .send({ name: `${runTag}-md-created` })
        .expect(403)
    })
  })

  // ─── COORDINATOR walkbacks ───────────────────────────────────────────────
  describe('COORDINATOR walkbacks (2026-07-01)', () => {
    it('cannot create a care-team assignment (403)', async () => {
      await request(srv())
        .post(`/admin/patients/${patientAId}/assignment`)
        .set('Authorization', `Bearer ${coordAToken}`)
        .send({
          practiceId: practiceAId,
          primaryProviderId: provAId,
          backupProviderId: provA2Id,
          medicalDirectorId: medAId,
        })
        .expect(403)
    })

    it('cannot update a care-team assignment (403)', async () => {
      await request(srv())
        .patch(`/admin/patients/${patientAId}/assignment`)
        .set('Authorization', `Bearer ${coordAToken}`)
        .send({ primaryProviderId: provA2Id })
        .expect(403)
    })

    it('cannot permanent-close a user (403)', async () => {
      await request(srv())
        .post(`/admin/users/${patientCoordTargetId}/permanent-close`)
        .set('Authorization', `Bearer ${coordAToken}`)
        .send({ confirmDisplayId: 'whatever', reason: 'x' })
        .expect(403)
    })
  })

  // ─── COORDINATOR retained powers ─────────────────────────────────────────
  describe('COORDINATOR retained powers', () => {
    it('can list users (200)', async () => {
      await request(srv())
        .get('/admin/users')
        .set('Authorization', `Bearer ${coordAToken}`)
        .expect(200)
    })

    it('can invite a PATIENT into their practice (201)', async () => {
      await request(srv())
        .post('/admin/users/invite')
        .set('Authorization', `Bearer ${coordAToken}`)
        .send({ email: email('coord-invitee'), name: 'Coord Invitee', role: 'PATIENT', practiceId: practiceAId })
        .expect(201)
    })

    it('can deactivate a patient in their practice (200/201)', async () => {
      const res = await request(srv())
        .post(`/admin/users/${patientCoordTargetId}/deactivate`)
        .set('Authorization', `Bearer ${coordAToken}`)
        .send({ reason: 'test' })
      expect([200, 201]).toContain(res.status)
    })
  })

  // ─── OPS / SUPER remain unscoped ─────────────────────────────────────────
  describe('OPS / SUPER remain org-wide', () => {
    it('OPS can PATCH any practice (200)', async () => {
      await request(srv())
        .patch(`/admin/practices/${practiceBId}`)
        .set('Authorization', `Bearer ${opsToken}`)
        .send({ businessHoursEnd: '20:00' })
        .expect(200)
    })

    it('SUPER can create a practice (201)', async () => {
      await request(srv())
        .post('/admin/practices')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `${runTag}-super-created` })
        .expect(201)
    })
  })
})
