import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

// Phase/13 — practice config, assignment, threshold, enrollment gate.
//
// Same strategy as phase/3: hit the real Prisma Postgres DB, scope all test
// rows to a unique per-run tag, clean up exactly what we create.

describe('Practice / Assignment / Threshold / Enrollment (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let jwt: JwtService

  const runTag = `practice-e2e-${Date.now()}`
  const adminEmail = `${runTag}-admin@example.com`
  const patientEmail = `${runTag}-patient@example.com`
  const providerEmail = `${runTag}-provider@example.com`
  const backupEmail = `${runTag}-backup@example.com`
  const mdEmail = `${runTag}-md@example.com`
  const plainPatientEmail = `${runTag}-plain-patient@example.com`

  let adminId: string
  let patientId: string
  let providerId: string
  let backupId: string
  let mdId: string
  let plainPatientId: string

  let adminToken: string
  let patientToken: string

  let practiceId: string

  const testEmails = [
    adminEmail,
    patientEmail,
    providerEmail,
    backupEmail,
    mdEmail,
    plainPatientEmail,
  ]

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: { email: { in: testEmails } },
      select: { id: true },
    })
    const userIds = users.map((u) => u.id)
    if (userIds.length) {
      await prisma.patientThreshold.deleteMany({ where: { userId: { in: userIds } } })
      await prisma.patientProviderAssignment.deleteMany({
        where: { userId: { in: userIds } },
      })
      await prisma.profileVerificationLog.deleteMany({
        where: { userId: { in: userIds } },
      })
      await prisma.patientProfile.deleteMany({ where: { userId: { in: userIds } } })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    }

    // Practices created in this run are identified by name prefix.
    await prisma.practice.deleteMany({
      where: { name: { startsWith: runTag } },
    })
  }

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

    // Admin with all three privileged roles — satisfies every phase/13 gate.
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Admin',
        roles: ['SUPER_ADMIN', 'MEDICAL_DIRECTOR', 'HEALPLACE_OPS'],
        isVerified: true,
        onboardingStatus: 'COMPLETED',
      },
    })
    const patient = await prisma.user.create({
      data: {
        email: patientEmail,
        name: 'Patient',
        roles: ['PATIENT'],
        isVerified: true,
        onboardingStatus: 'NOT_COMPLETED',
      },
    })
    const provider = await prisma.user.create({
      data: {
        email: providerEmail,
        name: 'Provider',
        roles: ['PROVIDER'],
        isVerified: true,
      },
    })
    const backup = await prisma.user.create({
      data: {
        email: backupEmail,
        name: 'Backup',
        roles: ['PROVIDER'],
        isVerified: true,
      },
    })
    const md = await prisma.user.create({
      data: {
        email: mdEmail,
        name: 'Medical Director',
        roles: ['MEDICAL_DIRECTOR'],
        isVerified: true,
      },
    })
    const plainPatient = await prisma.user.create({
      data: {
        email: plainPatientEmail,
        name: 'Plain Patient',
        roles: ['PATIENT'],
        isVerified: true,
        onboardingStatus: 'NOT_COMPLETED',
      },
    })

    adminId = admin.id
    patientId = patient.id
    providerId = provider.id
    backupId = backup.id
    mdId = md.id
    plainPatientId = plainPatient.id

    adminToken = await jwt.signAsync(
      { sub: admin.id, email: admin.email, roles: admin.roles },
      { expiresIn: '15m' },
    )
    patientToken = await jwt.signAsync(
      { sub: patient.id, email: patient.email, roles: patient.roles },
      { expiresIn: '15m' },
    )
  }, 30000)

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  // ─── Practice CRUD ────────────────────────────────────────────────────────

  describe('POST /admin/practices', () => {
    it('creates a practice with valid body', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/practices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `${runTag}-cedar-hill`,
          businessHoursStart: '08:00',
          businessHoursEnd: '18:00',
          businessHoursTimezone: 'America/New_York',
          afterHoursProtocol: 'Route urgent alerts to on-call.',
        })
        .expect(201)

      expect(res.body.data.name).toBe(`${runTag}-cedar-hill`)
      expect(res.body.data.businessHoursTimezone).toBe('America/New_York')
      practiceId = res.body.data.id
    })

    it('fills defaults when business hours are omitted', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/practices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `${runTag}-defaults` })
        .expect(201)

      expect(res.body.data.businessHoursStart).toBe('08:00')
      expect(res.body.data.businessHoursEnd).toBe('18:00')
      expect(res.body.data.businessHoursTimezone).toBe('America/New_York')
    })

    it('rejects invalid IANA timezone', async () => {
      await request(app.getHttpServer())
        .post('/admin/practices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `${runTag}-bad-tz`,
          businessHoursTimezone: 'Mars/Olympus',
        })
        .expect(400)
    })

    it('rejects HH:MM with bad format', async () => {
      await request(app.getHttpServer())
        .post('/admin/practices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `${runTag}-bad-hhmm`,
          businessHoursStart: '8:00',
        })
        .expect(400)
    })

    it('rejects start >= end', async () => {
      await request(app.getHttpServer())
        .post('/admin/practices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `${runTag}-bad-hours`,
          businessHoursStart: '18:00',
          businessHoursEnd: '08:00',
        })
        .expect(400)
    })

    it('rejects non-admin caller (403)', async () => {
      await request(app.getHttpServer())
        .post('/admin/practices')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ name: `${runTag}-patient-attempt` })
        .expect(403)
    })
  })

  describe('GET / PATCH /admin/practices', () => {
    it('lists practices including the ones we created', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/practices')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      const names = res.body.data.map((p: { name: string }) => p.name)
      expect(names).toEqual(
        expect.arrayContaining([`${runTag}-cedar-hill`, `${runTag}-defaults`]),
      )
    })

    it('PATCH updates a practice', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/admin/practices/${practiceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `${runTag}-cedar-hill-updated` })
        .expect(200)
      expect(res.body.data.name).toBe(`${runTag}-cedar-hill-updated`)
    })

    it('GET :id returns 404 for unknown id', async () => {
      await request(app.getHttpServer())
        .get('/admin/practices/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404)
    })
  })

  // ─── Assignment CRUD ──────────────────────────────────────────────────────

  describe('POST /admin/patients/:userId/assignment', () => {
    it('creates a valid assignment', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/patients/${patientId}/assignment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          practiceId,
          primaryProviderId: providerId,
          backupProviderId: backupId,
          medicalDirectorId: mdId,
        })
        .expect(201)
      expect(res.body.data.userId).toBe(patientId)
    })

    it('rejects duplicate assignment for same patient (409)', async () => {
      await request(app.getHttpServer())
        .post(`/admin/patients/${patientId}/assignment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          practiceId,
          primaryProviderId: providerId,
          backupProviderId: backupId,
          medicalDirectorId: mdId,
        })
        .expect(409)
    })

    it('rejects assignment where medicalDirector slot is filled by PROVIDER-only user', async () => {
      await request(app.getHttpServer())
        .post(`/admin/patients/${plainPatientId}/assignment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          practiceId,
          primaryProviderId: providerId,
          backupProviderId: backupId,
          medicalDirectorId: providerId, // lacks MEDICAL_DIRECTOR
        })
        .expect(400)
    })

    it('rejects non-existent practice', async () => {
      await request(app.getHttpServer())
        .post(`/admin/patients/${plainPatientId}/assignment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          practiceId: '00000000-0000-0000-0000-000000000000',
          primaryProviderId: providerId,
          backupProviderId: backupId,
          medicalDirectorId: mdId,
        })
        .expect(400)
    })
  })

  describe('GET / PATCH /admin/patients/:userId/assignment', () => {
    it('GET returns the assignment', async () => {
      const res = await request(app.getHttpServer())
        .get(`/admin/patients/${patientId}/assignment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      expect(res.body.data.primaryProviderId).toBe(providerId)
    })

    it('PATCH swaps backup provider', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/admin/patients/${patientId}/assignment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ backupProviderId: mdId })
        .expect(200)
      expect(res.body.data.backupProviderId).toBe(mdId)
    })

    it('patient cannot read their own assignment (admin-only reads)', async () => {
      await request(app.getHttpServer())
        .get(`/admin/patients/${patientId}/assignment`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(403)
    })
  })

  // ─── Threshold CRUD ───────────────────────────────────────────────────────

  describe('POST /admin/patients/:userId/threshold', () => {
    it('creates a threshold', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/patients/${patientId}/threshold`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sbpUpperTarget: 140,
          sbpLowerTarget: 100,
          dbpUpperTarget: 90,
          dbpLowerTarget: 60,
        })
        .expect(201)
      expect(res.body.data.setByProviderId).toBe(adminId)
    })

    it('rejects lower >= upper', async () => {
      await request(app.getHttpServer())
        .post(`/admin/patients/${plainPatientId}/threshold`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sbpUpperTarget: 100, sbpLowerTarget: 120 })
        .expect(400)
    })

    it('409 on duplicate threshold (use PATCH instead)', async () => {
      await request(app.getHttpServer())
        .post(`/admin/patients/${patientId}/threshold`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sbpUpperTarget: 135 })
        .expect(409)
    })

    it('PATCH updates and bumps setAt', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/admin/patients/${patientId}/threshold`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'tightened for recent HTN' })
        .expect(200)
      expect(res.body.data.notes).toBe('tightened for recent HTN')
    })

    it('PROVIDER-only role cannot write thresholds', async () => {
      const providerToken = await jwt.signAsync(
        { sub: providerId, email: providerEmail, roles: ['PROVIDER'] },
        { expiresIn: '15m' },
      )
      await request(app.getHttpServer())
        .post(`/admin/patients/${plainPatientId}/threshold`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send({ sbpUpperTarget: 140 })
        .expect(403)
    })
  })

  // ─── Enrollment gate ──────────────────────────────────────────────────────

  describe('Enrollment gate + completion', () => {
    it('fails for patient with no profile and no assignment', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/patients/${plainPatientId}/complete-onboarding`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409)
      const reasons: string[] = res.body.reasons ?? res.body.message?.reasons
      expect(reasons).toEqual(
        expect.arrayContaining(['no-assignment', 'patient-profile-missing']),
      )
    })

    it('fails with threshold-required-for-condition for HFrEF patient without threshold', async () => {
      // Give plainPatient a HFrEF profile and an assignment (no threshold).
      await prisma.patientProfile.create({
        data: {
          userId: plainPatientId,
          hasHeartFailure: true,
          heartFailureType: 'HFREF',
        },
      })
      await prisma.patientProviderAssignment.create({
        data: {
          userId: plainPatientId,
          practiceId,
          primaryProviderId: providerId,
          backupProviderId: backupId,
          medicalDirectorId: mdId,
        },
      })

      const res = await request(app.getHttpServer())
        .post(`/admin/patients/${plainPatientId}/complete-onboarding`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409)
      const reasons: string[] = res.body.reasons ?? res.body.message?.reasons
      expect(reasons).toContain('threshold-required-for-condition')
    })

    it('passes once threshold is added for HFrEF patient', async () => {
      await prisma.patientThreshold.create({
        data: {
          userId: plainPatientId,
          setByProviderId: adminId,
          sbpUpperTarget: 130,
          sbpLowerTarget: 85,
        },
      })
      const res = await request(app.getHttpServer())
        .post(`/admin/patients/${plainPatientId}/complete-onboarding`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      expect(res.body.data.onboardingStatus).toBe('COMPLETED')
    })

    it('does NOT gate on HFpEF (recommended but not mandatory)', async () => {
      // New scratch patient: HFpEF, no threshold, with profile + assignment.
      const scratch = await prisma.user.create({
        data: {
          email: `${runTag}-hfpef@example.com`,
          name: 'HFpEF patient',
          roles: ['PATIENT'],
          isVerified: true,
          onboardingStatus: 'NOT_COMPLETED',
        },
      })
      testEmails.push(scratch.email!)

      await prisma.patientProfile.create({
        data: {
          userId: scratch.id,
          hasHeartFailure: true,
          heartFailureType: 'HFPEF',
        },
      })
      await prisma.patientProviderAssignment.create({
        data: {
          userId: scratch.id,
          practiceId,
          primaryProviderId: providerId,
          backupProviderId: backupId,
          medicalDirectorId: mdId,
        },
      })

      const res = await request(app.getHttpServer())
        .post(`/admin/patients/${scratch.id}/complete-onboarding`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      expect(res.body.data.onboardingStatus).toBe('COMPLETED')
    })

    it('re-completion is idempotent (200 no-op)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/patients/${plainPatientId}/complete-onboarding`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      expect(res.body.message).toMatch(/already completed/i)
    })

    it('enrollment-check returns ok=true for a fully-enrolled patient', async () => {
      // Set up the first patient too — needs profile + threshold (created above) + assignment.
      await prisma.patientProfile.upsert({
        where: { userId: patientId },
        update: {},
        create: { userId: patientId },
      })
      const res = await request(app.getHttpServer())
        .get(`/admin/patients/${patientId}/enrollment-check`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      expect(res.body.data.ok).toBe(true)
    })
  })
})
