import { jest } from '@jest/globals'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

// Phase/3 — patient intake + admin verification API.
//
// These tests hit the real Prisma Postgres database (same as dev) because the
// project hasn't yet split a test DB. Every user/profile/medication row is
// scoped to a unique per-run email prefix so we can delete exactly what we
// created, and nothing else.

// Managed Prisma Postgres has a multi-second handshake on cold connections
// and 100–300 ms per query even warm, which blows past Jest's 5 s default on
// the first test in the suite. Bump to 30 s so real DB round-trips have room.
jest.setTimeout(30_000)

describe('Intake API (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let jwt: JwtService

  const runTag = `intake-e2e-${Date.now()}`
  const patientEmail = `${runTag}-patient@example.com`
  const adminEmail = `${runTag}-admin@example.com`
  let patientId: string
  let adminId: string
  let patientToken: string
  let adminToken: string

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: { email: { in: [patientEmail, adminEmail] } },
      select: { id: true },
    })
    const userIds = users.map((u) => u.id)
    if (!userIds.length) return
    // Cascade will drop PatientProfile, PatientMedication,
    // ProfileVerificationLog rows tied to these users.
    await prisma.profileVerificationLog.deleteMany({
      where: { userId: { in: userIds } },
    })
    await prisma.patientMedication.deleteMany({
      where: { userId: { in: userIds } },
    })
    await prisma.patientProfile.deleteMany({
      where: { userId: { in: userIds } },
    })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    // Match main.ts — the ValidationPipe is only applied in bootstrap, not
    // automatically in TestingModule.
    app.useGlobalPipes(new ValidationPipe({ transform: true }))
    prisma = moduleFixture.get(PrismaService)
    jwt = moduleFixture.get(JwtService)
    await app.init()

    await cleanup()

    const patient = await prisma.user.create({
      data: {
        email: patientEmail,
        name: 'Test Patient',
        roles: ['PATIENT'],
        isVerified: true,
        onboardingStatus: 'COMPLETED',
      },
    })
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Test Admin',
        roles: ['SUPER_ADMIN', 'PROVIDER'],
        isVerified: true,
        onboardingStatus: 'COMPLETED',
      },
    })
    patientId = patient.id
    adminId = admin.id
    patientToken = await jwt.signAsync(
      { sub: patient.id, email: patient.email, roles: patient.roles },
      { expiresIn: '15m' },
    )
    adminToken = await jwt.signAsync(
      { sub: admin.id, email: admin.email, roles: admin.roles },
      { expiresIn: '15m' },
    )
  }, 30000)

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  // ─── Patient profile intake ────────────────────────────────────────────────

  describe('POST /intake/profile', () => {
    it('creates a new PatientProfile and logs every field as PATIENT_REPORT', async () => {
      const res = await request(app.getHttpServer())
        .post('/intake/profile')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          gender: 'FEMALE',
          heightCm: 165,
          hasHeartFailure: true,
          heartFailureType: 'HFREF',
        })
        .expect(200)

      expect(res.body.data.profileVerificationStatus).toBe('UNVERIFIED')
      expect(res.body.changedFields).toEqual(
        expect.arrayContaining([
          'gender',
          'heightCm',
          'hasHeartFailure',
          'heartFailureType',
        ]),
      )

      const stored = await prisma.patientProfile.findUnique({
        where: { userId: patientId },
      })
      expect(stored).not.toBeNull()
      expect(stored?.gender).toBe('FEMALE')
      expect(stored?.heartFailureType).toBe('HFREF')

      const logs = await prisma.profileVerificationLog.findMany({
        where: { userId: patientId, changeType: 'PATIENT_REPORT' },
      })
      expect(logs).toHaveLength(4)
      for (const l of logs) {
        expect(l.changedBy).toBe(patientId)
        expect(l.changedByRole).toBe('PATIENT')
      }
    })

    it('flips a VERIFIED profile back to UNVERIFIED when patient edits', async () => {
      // Simulate a prior admin verification.
      await prisma.patientProfile.update({
        where: { userId: patientId },
        data: {
          profileVerificationStatus: 'VERIFIED',
          profileVerifiedAt: new Date(),
          profileVerifiedBy: adminId,
        },
      })

      const res = await request(app.getHttpServer())
        .post('/intake/profile')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ hasAFib: true })
        .expect(200)

      expect(res.body.data.profileVerificationStatus).toBe('UNVERIFIED')
      expect(res.body.data.profileVerifiedAt).toBeNull()
      expect(res.body.changedFields).toEqual(['hasAFib'])
    })

    it('does not log when a patient sends the same value they already had', async () => {
      const logsBefore = await prisma.profileVerificationLog.count({
        where: { userId: patientId },
      })

      const res = await request(app.getHttpServer())
        .post('/intake/profile')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ hasAFib: true }) // already true
        .expect(200)

      expect(res.body.changedFields).toEqual([])

      const logsAfter = await prisma.profileVerificationLog.count({
        where: { userId: patientId },
      })
      expect(logsAfter).toBe(logsBefore)
    })

    it('rejects pregnancyDueDate when isPregnant is false', async () => {
      await request(app.getHttpServer())
        .post('/intake/profile')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          isPregnant: false,
          pregnancyDueDate: '2026-10-01T00:00:00.000Z',
        })
        .expect(400)
    })

    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .post('/intake/profile')
        .send({ gender: 'FEMALE' })
        .expect(401)
    })
  })

  // ─── Medication intake ─────────────────────────────────────────────────────

  describe('POST /intake/medications', () => {
    let firstMedId: string

    it('creates medications and flips profile back to UNVERIFIED', async () => {
      // First, re-verify the profile so we can see the flip happen.
      await prisma.patientProfile.update({
        where: { userId: patientId },
        data: {
          profileVerificationStatus: 'VERIFIED',
          profileVerifiedAt: new Date(),
          profileVerifiedBy: adminId,
        },
      })

      const res = await request(app.getHttpServer())
        .post('/intake/medications')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          medications: [
            {
              drugName: 'Lisinopril',
              drugClass: 'ACE_INHIBITOR',
              frequency: 'ONCE_DAILY',
            },
            {
              drugName: 'Carvedilol',
              drugClass: 'BETA_BLOCKER',
              frequency: 'TWICE_DAILY',
            },
          ],
        })
        .expect(201)

      expect(res.body.data).toHaveLength(2)
      expect(res.body.data[0].verificationStatus).toBe('UNVERIFIED')
      firstMedId = res.body.data[0].id

      const profile = await prisma.patientProfile.findUnique({
        where: { userId: patientId },
      })
      expect(profile?.profileVerificationStatus).toBe('UNVERIFIED')

      const medLogs = await prisma.profileVerificationLog.findMany({
        where: {
          userId: patientId,
          fieldPath: { startsWith: 'medication:' },
        },
      })
      expect(medLogs.length).toBeGreaterThanOrEqual(2)
    })

    it('PATCH /me/medications/:id updates and logs each changed field', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/me/medications/${firstMedId}`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ frequency: 'TWICE_DAILY', notes: 'morning and evening' })
        .expect(200)

      expect(res.body.data.frequency).toBe('TWICE_DAILY')
      expect(res.body.data.verificationStatus).toBe('UNVERIFIED')

      const logs = await prisma.profileVerificationLog.findMany({
        where: {
          userId: patientId,
          fieldPath: { in: [
            `medication:${firstMedId}.frequency`,
            `medication:${firstMedId}.notes`,
          ] },
        },
      })
      expect(logs).toHaveLength(2)
    })

    it('PATCH /me/medications/:id with discontinue=true soft-deletes', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/me/medications/${firstMedId}`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ discontinue: true })
        .expect(200)

      expect(res.body.data.discontinuedAt).not.toBeNull()

      // A further edit on a discontinued med should 400.
      await request(app.getHttpServer())
        .patch(`/me/medications/${firstMedId}`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ notes: 'should fail' })
        .expect(400)
    })

    it('rejects invalid drugClass', async () => {
      await request(app.getHttpServer())
        .post('/intake/medications')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          medications: [
            {
              drugName: 'Mystery',
              drugClass: 'NOT_A_REAL_CLASS',
              frequency: 'ONCE_DAILY',
            },
          ],
        })
        .expect(400)
    })
  })

  // ─── POST /intake/medications dedup (phase/21) ─────────────────────────────

  describe('POST /intake/medications — dedup', () => {
    // Dedicated patient so state from the earlier POST/PATCH/PUT blocks
    // doesn't poison the canonical-key lookups.
    const dedupEmail = `${runTag}-dedup-patient@example.com`
    let dedupId: string
    let dedupToken: string

    async function activeMedsFor(userId: string) {
      return prisma.patientMedication.findMany({
        where: { userId, discontinuedAt: null },
        orderBy: { reportedAt: 'asc' },
      })
    }

    beforeAll(async () => {
      const patient = await prisma.user.create({
        data: {
          email: dedupEmail,
          name: 'Dedup Patient',
          roles: ['PATIENT'],
          isVerified: true,
          onboardingStatus: 'COMPLETED',
        },
      })
      dedupId = patient.id
      dedupToken = jwt.sign({
        sub: patient.id,
        email: patient.email,
        roles: patient.roles,
      })
      await prisma.patientProfile.create({
        data: {
          userId: dedupId,
          gender: 'MALE',
          heightCm: 178,
          profileVerificationStatus: 'UNVERIFIED',
        },
      })
    })

    afterAll(async () => {
      await prisma.profileVerificationLog.deleteMany({
        where: { userId: dedupId },
      })
      await prisma.patientMedication.deleteMany({ where: { userId: dedupId } })
      await prisma.patientProfile.deleteMany({ where: { userId: dedupId } })
      await prisma.user.deleteMany({ where: { id: dedupId } })
    })

    it('POST same medication twice creates only one active row', async () => {
      const payload = {
        medications: [
          {
            drugName: 'Eliquis',
            drugClass: 'ANTICOAGULANT',
            frequency: 'TWICE_DAILY',
          },
        ],
      }

      const first = await request(app.getHttpServer())
        .post('/intake/medications')
        .set('Authorization', `Bearer ${dedupToken}`)
        .send(payload)
        .expect(201)
      expect(first.body.data).toHaveLength(1)
      const firstId = first.body.data[0].id

      const second = await request(app.getHttpServer())
        .post('/intake/medications')
        .set('Authorization', `Bearer ${dedupToken}`)
        .send(payload)
        .expect(201)
      // Response still echoes the canonical row so the client gets a usable
      // medicationId either way, but no new row is created.
      expect(second.body.data).toHaveLength(1)
      expect(second.body.data[0].id).toBe(firstId)
      expect(second.body.message).toMatch(/duplicate.*skipped/i)

      const active = await activeMedsFor(dedupId)
      expect(active).toHaveLength(1)
      expect(active[0].id).toBe(firstId)
    })

    it('mixed payload — only the new medication is created, existing is preserved', async () => {
      const beforeIds = (await activeMedsFor(dedupId)).map((m) => m.id)

      const res = await request(app.getHttpServer())
        .post('/intake/medications')
        .set('Authorization', `Bearer ${dedupToken}`)
        .send({
          medications: [
            // Already-active dup — should be skipped.
            {
              drugName: 'Eliquis',
              drugClass: 'ANTICOAGULANT',
              frequency: 'TWICE_DAILY',
            },
            // Net-new — should be created.
            {
              drugName: 'Toprol XL',
              drugClass: 'BETA_BLOCKER',
              frequency: 'ONCE_DAILY',
            },
          ],
        })
        .expect(201)
      expect(res.body.data).toHaveLength(2)
      expect(res.body.message).toMatch(/1 medication\(s\) recorded.*1 duplicate/i)

      const active = await activeMedsFor(dedupId)
      expect(active).toHaveLength(2)
      const newIds = active.map((m) => m.id).filter((id) => !beforeIds.includes(id))
      expect(newIds).toHaveLength(1)
    })

    it('case-insensitive drugName — "ELIQUIS" matches "Eliquis"', async () => {
      const before = await activeMedsFor(dedupId)
      const beforeCount = before.length

      await request(app.getHttpServer())
        .post('/intake/medications')
        .set('Authorization', `Bearer ${dedupToken}`)
        .send({
          medications: [
            {
              drugName: 'ELIQUIS',
              drugClass: 'ANTICOAGULANT',
              frequency: 'TWICE_DAILY',
            },
          ],
        })
        .expect(201)

      const after = await activeMedsFor(dedupId)
      expect(after).toHaveLength(beforeCount)
    })

    it('re-add allowed after discontinue (different active row, same canonical key)', async () => {
      const eliquis = (await activeMedsFor(dedupId)).find(
        (m) => m.drugName === 'Eliquis',
      )!
      // Discontinue the active Eliquis.
      await request(app.getHttpServer())
        .patch(`/me/medications/${eliquis.id}`)
        .set('Authorization', `Bearer ${dedupToken}`)
        .send({ discontinue: true })
        .expect(200)

      // Now re-adding it should produce a new active row — the partial unique
      // index excludes discontinued rows.
      const res = await request(app.getHttpServer())
        .post('/intake/medications')
        .set('Authorization', `Bearer ${dedupToken}`)
        .send({
          medications: [
            {
              drugName: 'Eliquis',
              drugClass: 'ANTICOAGULANT',
              frequency: 'TWICE_DAILY',
            },
          ],
        })
        .expect(201)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].id).not.toBe(eliquis.id)

      const activeEliquis = (await activeMedsFor(dedupId)).filter(
        (m) => m.drugName === 'Eliquis',
      )
      expect(activeEliquis).toHaveLength(1)
    })

    it('DB partial unique index rejects direct duplicate insert (belt to suspenders)', async () => {
      // Bypass the app dedup by hitting Prisma directly. The migration's
      // partial unique index on active rows must throw P2002.
      const eliquis = (await activeMedsFor(dedupId)).find(
        (m) => m.drugName === 'Eliquis',
      )!
      await expect(
        prisma.patientMedication.create({
          data: {
            userId: dedupId,
            drugName: eliquis.drugName,
            drugClass: eliquis.drugClass,
            frequency: eliquis.frequency,
            isCombination: eliquis.isCombination,
            combinationComponents: eliquis.combinationComponents,
            source: 'PATIENT_SELF_REPORT',
            verificationStatus: 'UNVERIFIED',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' })
    })

    it('within-payload dedup — same med listed twice in one POST creates one row', async () => {
      const before = await activeMedsFor(dedupId)
      const beforeCount = before.length

      const res = await request(app.getHttpServer())
        .post('/intake/medications')
        .set('Authorization', `Bearer ${dedupToken}`)
        .send({
          medications: [
            {
              drugName: 'Atorvastatin',
              drugClass: 'STATIN',
              frequency: 'ONCE_DAILY',
            },
            {
              drugName: 'Atorvastatin',
              drugClass: 'STATIN',
              frequency: 'ONCE_DAILY',
            },
          ],
        })
        .expect(201)
      expect(res.body.data).toHaveLength(1)

      const after = await activeMedsFor(dedupId)
      expect(after).toHaveLength(beforeCount + 1)
    })
  })

  // ─── Medication replace (PUT /me/medications) ──────────────────────────────

  describe('PUT /me/medications', () => {
    // Use a separate patient so state from earlier blocks doesn't leak in.
    const replaceEmail = `${runTag}-replace-patient@example.com`
    let replaceId: string
    let replaceToken: string

    async function activeMeds() {
      return prisma.patientMedication.findMany({
        where: { userId: replaceId, discontinuedAt: null },
        orderBy: { reportedAt: 'asc' },
      })
    }
    async function reverify() {
      await prisma.patientProfile.update({
        where: { userId: replaceId },
        data: {
          profileVerificationStatus: 'VERIFIED',
          profileVerifiedAt: new Date(),
          profileVerifiedBy: adminId,
        },
      })
    }

    beforeAll(async () => {
      const patient = await prisma.user.create({
        data: {
          email: replaceEmail,
          name: 'Replace Patient',
          roles: ['PATIENT'],
          isVerified: true,
          onboardingStatus: 'COMPLETED',
        },
      })
      replaceId = patient.id
      replaceToken = jwt.sign({
        sub: patient.id,
        email: patient.email,
        roles: patient.roles,
      })
      await prisma.patientProfile.create({
        data: {
          userId: replaceId,
          gender: 'FEMALE',
          heightCm: 165,
          profileVerificationStatus: 'UNVERIFIED',
        },
      })
      // Seed two meds so replace has something to diff against.
      await prisma.patientMedication.createMany({
        data: [
          {
            userId: replaceId,
            drugName: 'Lisinopril',
            drugClass: 'ACE_INHIBITOR',
            frequency: 'ONCE_DAILY',
            source: 'PATIENT_SELF_REPORT',
            verificationStatus: 'UNVERIFIED',
          },
          {
            userId: replaceId,
            drugName: 'Carvedilol',
            drugClass: 'BETA_BLOCKER',
            frequency: 'TWICE_DAILY',
            source: 'PATIENT_SELF_REPORT',
            verificationStatus: 'UNVERIFIED',
          },
        ],
      })
    })

    afterAll(async () => {
      await prisma.profileVerificationLog.deleteMany({
        where: { userId: replaceId },
      })
      await prisma.patientMedication.deleteMany({ where: { userId: replaceId } })
      await prisma.patientProfile.deleteMany({ where: { userId: replaceId } })
      await prisma.user.deleteMany({ where: { id: replaceId } })
    })

    it('leaves matching rows untouched and flips nothing when the list is identical', async () => {
      await reverify()
      const before = await activeMeds()

      await request(app.getHttpServer())
        .put('/me/medications')
        .set('Authorization', `Bearer ${replaceToken}`)
        .send({
          medications: before.map((m) => ({
            drugName: m.drugName,
            drugClass: m.drugClass,
            frequency: m.frequency,
            isCombination: m.isCombination,
            combinationComponents: m.combinationComponents,
          })),
        })
        .expect(200)

      const after = await activeMeds()
      expect(after.map((m) => m.id).sort()).toEqual(
        before.map((m) => m.id).sort(),
      )
      const profile = await prisma.patientProfile.findUnique({
        where: { userId: replaceId },
      })
      expect(profile?.profileVerificationStatus).toBe('VERIFIED')
    })

    it('soft-closes removed rows, creates added rows, and flips VERIFIED → UNVERIFIED', async () => {
      await reverify()
      const before = await activeMeds()

      // Keep Lisinopril, drop Carvedilol, add Amlodipine.
      const res = await request(app.getHttpServer())
        .put('/me/medications')
        .set('Authorization', `Bearer ${replaceToken}`)
        .send({
          medications: [
            {
              drugName: 'Lisinopril',
              drugClass: 'ACE_INHIBITOR',
              frequency: 'ONCE_DAILY',
            },
            {
              drugName: 'Norvasc',
              drugClass: 'DHP_CCB',
              frequency: 'ONCE_DAILY',
            },
          ],
        })
        .expect(200)

      expect(res.body.data).toHaveLength(2)
      const names = res.body.data.map((m: { drugName: string }) => m.drugName).sort()
      expect(names).toEqual(['Lisinopril', 'Norvasc'])

      const carvedilol = before.find((m) => m.drugName === 'Carvedilol')
      if (!carvedilol) throw new Error('Carvedilol missing from seed')
      const after = await prisma.patientMedication.findUnique({
        where: { id: carvedilol.id },
      })
      expect(after?.discontinuedAt).not.toBeNull()

      const profile = await prisma.patientProfile.findUnique({
        where: { userId: replaceId },
      })
      expect(profile?.profileVerificationStatus).toBe('UNVERIFIED')
      expect(profile?.profileVerifiedAt).toBeNull()

      const logs = await prisma.profileVerificationLog.findMany({
        where: {
          userId: replaceId,
          fieldPath: { startsWith: 'medication:' },
          rationale: 'patient self-edit post-verification',
        },
      })
      expect(logs.length).toBeGreaterThanOrEqual(2)
    })

    it('treats frequency change as remove + add (since key includes frequency)', async () => {
      await reverify()
      const before = await activeMeds()
      const lisi = before.find((m) => m.drugName === 'Lisinopril')
      if (!lisi) throw new Error('Lisinopril missing from seed')

      await request(app.getHttpServer())
        .put('/me/medications')
        .set('Authorization', `Bearer ${replaceToken}`)
        .send({
          medications: before.map((m) => ({
            drugName: m.drugName,
            drugClass: m.drugClass,
            frequency: m.id === lisi.id ? 'TWICE_DAILY' : m.frequency,
            isCombination: m.isCombination,
            combinationComponents: m.combinationComponents,
          })),
        })
        .expect(200)

      const oldLisi = await prisma.patientMedication.findUnique({
        where: { id: lisi.id },
      })
      expect(oldLisi?.discontinuedAt).not.toBeNull()

      const active = await activeMeds()
      const newLisi = active.find(
        (m) => m.drugName === 'Lisinopril' && m.frequency === 'TWICE_DAILY',
      )
      expect(newLisi).toBeDefined()
      expect(newLisi?.verificationStatus).toBe('UNVERIFIED')

      const profile = await prisma.patientProfile.findUnique({
        where: { userId: replaceId },
      })
      expect(profile?.profileVerificationStatus).toBe('UNVERIFIED')
    })

    it('accepts an empty list and soft-closes everything', async () => {
      await request(app.getHttpServer())
        .put('/me/medications')
        .set('Authorization', `Bearer ${replaceToken}`)
        .send({ medications: [] })
        .expect(200)

      const active = await activeMeds()
      expect(active).toHaveLength(0)
    })
  })

  // ─── Pregnancy ─────────────────────────────────────────────────────────────

  describe('POST /me/pregnancy', () => {
    it('sets pregnancy and due date together', async () => {
      const res = await request(app.getHttpServer())
        .post('/me/pregnancy')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          isPregnant: true,
          pregnancyDueDate: '2026-11-01T00:00:00.000Z',
          historyHDP: true,
        })
        .expect(200)

      expect(res.body.data.isPregnant).toBe(true)
      expect(res.body.data.historyHDP).toBe(true)
      expect(res.body.data.pregnancyDueDate).toBe(
        '2026-11-01T00:00:00.000Z',
      )
    })

    it('clears the due date when patient reports no longer pregnant', async () => {
      const res = await request(app.getHttpServer())
        .post('/me/pregnancy')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ isPregnant: false })
        .expect(200)

      expect(res.body.data.isPregnant).toBe(false)
      expect(res.body.data.pregnancyDueDate).toBeNull()
    })
  })

  // ─── Admin verification ────────────────────────────────────────────────────

  describe('Admin verification', () => {
    it('POST /admin/users/:id/verify-profile marks the profile VERIFIED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/users/${patientId}/verify-profile`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ rationale: 'Confirmed with patient at intake' })
        .expect(200)

      expect(res.body.data.profileVerificationStatus).toBe('VERIFIED')
      expect(res.body.data.profileVerifiedBy).toBe(adminId)

      const log = await prisma.profileVerificationLog.findFirst({
        where: {
          userId: patientId,
          changeType: 'ADMIN_VERIFY',
          fieldPath: 'profile.verificationStatus',
        },
        orderBy: { createdAt: 'desc' },
      })
      expect(log).not.toBeNull()
      expect(log?.changedBy).toBe(adminId)
      expect(log?.rationale).toBe('Confirmed with patient at intake')
    })

    it('POST /admin/users/:id/correct-profile flips to CORRECTED and flags discrepancies', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/users/${patientId}/correct-profile`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          corrections: { heartFailureType: 'HFPEF' },
          rationale: 'Chart review: patient has HFpEF per echo',
        })
        .expect(200)

      expect(res.body.data.profileVerificationStatus).toBe('CORRECTED')
      expect(res.body.correctedFields).toEqual(['heartFailureType'])

      const log = await prisma.profileVerificationLog.findFirst({
        where: {
          userId: patientId,
          changeType: 'ADMIN_CORRECT',
          fieldPath: 'profile.heartFailureType',
        },
      })
      expect(log?.discrepancyFlag).toBe(true)
      expect(log?.rationale).toContain('HFpEF')
    })

    it('correct-profile with no actual changes is rejected', async () => {
      // Re-send the same HFPEF value we just stored.
      await request(app.getHttpServer())
        .post(`/admin/users/${patientId}/correct-profile`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          corrections: { heartFailureType: 'HFPEF' },
          rationale: 'No-op',
        })
        .expect(400)
    })

    it('correct-profile requires rationale', async () => {
      await request(app.getHttpServer())
        .post(`/admin/users/${patientId}/correct-profile`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ corrections: { heightCm: 170 } })
        .expect(400)
    })

    it('POST /admin/medications/:id/verify marks a med VERIFIED', async () => {
      // Create a fresh med to verify (the earlier one was discontinued).
      const med = await prisma.patientMedication.create({
        data: {
          userId: patientId,
          drugName: 'Amlodipine',
          drugClass: 'DHP_CCB',
          frequency: 'ONCE_DAILY',
          source: 'PATIENT_SELF_REPORT',
        },
      })

      const res = await request(app.getHttpServer())
        .post(`/admin/medications/${med.id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'VERIFIED' })
        .expect(200)

      expect(res.body.data.verificationStatus).toBe('VERIFIED')
      expect(res.body.data.verifiedByAdminId).toBe(adminId)

      const log = await prisma.profileVerificationLog.findFirst({
        where: {
          userId: patientId,
          fieldPath: `medication:${med.id}.verificationStatus`,
          changeType: 'ADMIN_VERIFY',
        },
      })
      expect(log).not.toBeNull()
    })

    it('rejecting a medication requires a rationale', async () => {
      const med = await prisma.patientMedication.create({
        data: {
          userId: patientId,
          drugName: 'Mystery pill',
          drugClass: 'OTHER_UNVERIFIED',
          frequency: 'UNSURE',
          source: 'PATIENT_VOICE',
        },
      })

      await request(app.getHttpServer())
        .post(`/admin/medications/${med.id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'REJECTED' })
        .expect(400)

      await request(app.getHttpServer())
        .post(`/admin/medications/${med.id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'REJECTED', rationale: 'Cannot identify from photo' })
        .expect(200)
    })

    it('patients cannot call admin endpoints', async () => {
      await request(app.getHttpServer())
        .post(`/admin/users/${patientId}/verify-profile`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({})
        .expect(403)
    })
  })
})
