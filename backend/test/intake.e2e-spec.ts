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

  // ─── Pregnancy ─────────────────────────────────────────────────────────────

  describe('POST /me/pregnancy', () => {
    it('sets pregnancy and due date together', async () => {
      const res = await request(app.getHttpServer())
        .post('/me/pregnancy')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          isPregnant: true,
          pregnancyDueDate: '2026-11-01T00:00:00.000Z',
          historyPreeclampsia: true,
        })
        .expect(200)

      expect(res.body.data.isPregnant).toBe(true)
      expect(res.body.data.historyPreeclampsia).toBe(true)
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
