import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { generateTestDisplayId } from './helpers/generate-test-display-id.js'

// Support System Phase 1 — backend e2e (HIPAA sprint, Nivakaran).
// Hits the real Prisma Postgres DB like the other e2e specs; scopes rows to a
// per-run tag + a per-run IP so re-runs inside the rate-limit hour stay clean.
//
// Covers the sprint's required flow (p.8): the full ticket -> reply -> reset ->
// resolve chain, the identity-verify gate blocking sensitive actions, that
// every privileged action writes a SupportTicketAction, and the 5/IP/hour cap.

describe('Support System Phase 1 (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let jwt: JwtService

  const runTag = `support-e2e-${Date.now()}`
  // Per-run IP so the rate-limit window is fresh each run (the endpoint keys on IP).
  const rlStamp = Date.now()
  const rlIp = `10.${(rlStamp >> 16) & 255}.${(rlStamp >> 8) & 255}.${rlStamp & 255}`

  const patientEmail = `${runTag}-patient@example.com`
  const opsEmail = `${runTag}-ops@example.com`
  const testEmails = [patientEmail, opsEmail]

  let patientId: string
  let opsId: string
  let patientToken: string
  let opsToken: string

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: { email: { in: testEmails } },
      select: { id: true },
    })
    const ids = users.map((u) => u.id)
    // Tickets: matched-user, locked-out (by email), and rate-limit probes (by IP).
    // Cascade removes their replies + actions.
    await prisma.supportTicket.deleteMany({
      where: {
        OR: [
          { userId: { in: ids } },
          { email: { in: testEmails } },
          { ipAddress: rlIp },
        ],
      },
    })
    // Ops new-ticket notifications fan out to every HEALPLACE_OPS user (incl.
    // seeds) — remove the ones this run created by their title shape.
    await prisma.notification.deleteMany({
      where: { title: { startsWith: 'New support ticket ' } },
    })
    if (ids.length) {
      await prisma.notification.deleteMany({ where: { userId: { in: ids } } })
      await prisma.authLog.deleteMany({ where: { userId: { in: ids } } })
      await prisma.user.deleteMany({ where: { id: { in: ids } } })
    }
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

    const patient = await prisma.user.create({
      data: {
        email: patientEmail,
        name: 'E2E Patient',
        roles: ['PATIENT'],
        isVerified: true,
        displayId: generateTestDisplayId(['PATIENT']),
      },
    })
    const ops = await prisma.user.create({
      data: {
        email: opsEmail,
        name: 'E2E Ops',
        roles: ['HEALPLACE_OPS'],
        isVerified: true,
        displayId: generateTestDisplayId(['HEALPLACE_OPS']),
      },
    })
    patientId = patient.id
    opsId = ops.id

    patientToken = await jwt.signAsync(
      { sub: patient.id, email: patient.email, roles: patient.roles },
      { expiresIn: '15m' },
    )
    opsToken = await jwt.signAsync(
      { sub: ops.id, email: ops.email, roles: ops.roles },
      { expiresIn: '15m' },
    )
  }, 30000)

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  const server = () => app.getHttpServer()

  // ─── Full flow: contact -> queue -> reply -> resolve ──────────────────────
  describe('full flow: contact -> queue -> reply -> resolve', () => {
    let ticketId: string
    let ticketNumber: string

    it('patient submits a contact ticket (lands identity-verified)', async () => {
      const res = await request(server())
        .post('/v2/support/contact')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ subject: 'Readings tab is blank', body: 'Please help', category: 'BUG' })
        .expect(201)
      ticketNumber = res.body.ticketNumber
      expect(ticketNumber).toMatch(/^CP-SUP-/)
    }, 20000)

    it('ops sees it in the queue, identity-verified', async () => {
      const res = await request(server())
        .get(`/v2/admin/support/tickets?search=${encodeURIComponent(ticketNumber)}`)
        .set('Authorization', `Bearer ${opsToken}`)
        .expect(200)
      const row = res.body.data.find(
        (t: { ticketNumber: string }) => t.ticketNumber === ticketNumber,
      )
      expect(row).toBeTruthy()
      expect(row.identityVerified).toBe(true)
      ticketId = row.id
    })

    it('ops replies -> creates OPS reply + a patient dashboard notification', async () => {
      await request(server())
        .post(`/v2/admin/support/tickets/${ticketId}/reply`)
        .set('Authorization', `Bearer ${opsToken}`)
        .send({ body: 'Thanks — looking into it.' })
        .expect(201)
      const replies = await prisma.supportTicketReply.findMany({ where: { ticketId } })
      expect(replies.some((r) => r.authorType === 'OPS')).toBe(true)
      const notif = await prisma.notification.findFirst({
        where: { userId: patientId, channel: 'DASHBOARD' },
      })
      expect(notif).toBeTruthy()
    })

    it('ops resolves -> status RESOLVED + a RESOLVED audit action', async () => {
      await request(server())
        .post(`/v2/admin/support/tickets/${ticketId}/resolve`)
        .set('Authorization', `Bearer ${opsToken}`)
        .send({ resolutionNotes: 'Advised cache clear; confirmed fixed.' })
        .expect(201)
      const t = await prisma.supportTicket.findUnique({ where: { id: ticketId } })
      expect(t?.status).toBe('RESOLVED')
      const actions = await prisma.supportTicketAction.findMany({ where: { ticketId } })
      expect(actions.some((a) => a.actionType === 'RESOLVED')).toBe(true)
    })
  })

  // ─── Identity-verify gate: locked-out -> blocked -> verify -> reset ───────
  describe('identity-verify gate + reset wrapper', () => {
    let ticketId: string

    it('public locked-out ticket lands unverified + linked to the account', async () => {
      const res = await request(server())
        .post('/v2/support/locked-out')
        .send({ email: patientEmail, description: 'Lost my authenticator and codes' })
        .expect(201)
      expect(res.body.ticketNumber).toMatch(/^CP-SUP-/)
      const t = await prisma.supportTicket.findFirst({
        where: { email: patientEmail, identityVerified: false },
        orderBy: { createdAt: 'desc' },
      })
      expect(t).toBeTruthy()
      expect(t?.userId).toBe(patientId) // matched by email lookup
      ticketId = t!.id
    }, 20000)

    it('mfa-reset is BLOCKED before identity is verified (403)', async () => {
      await request(server())
        .post(`/v2/admin/support/tickets/${ticketId}/actions/mfa-reset`)
        .set('Authorization', `Bearer ${opsToken}`)
        .send({})
        .expect(403)
    })

    it('ops verifies identity -> flips ticket + writes IDENTITY_VERIFIED', async () => {
      await request(server())
        .post(`/v2/admin/support/tickets/${ticketId}/verify-identity`)
        .set('Authorization', `Bearer ${opsToken}`)
        .send({ rationale: 'Confirmed DOB + last 4 via reply email' })
        .expect(201)
      const t = await prisma.supportTicket.findUnique({ where: { id: ticketId } })
      expect(t?.identityVerified).toBe(true)
      const acts = await prisma.supportTicketAction.findMany({ where: { ticketId } })
      expect(acts.some((a) => a.actionType === 'IDENTITY_VERIFIED')).toBe(true)
    })

    it('mfa-reset now succeeds + writes an MFA_RESET audit action', async () => {
      await request(server())
        .post(`/v2/admin/support/tickets/${ticketId}/actions/mfa-reset`)
        .set('Authorization', `Bearer ${opsToken}`)
        .send({ reason: 'verified by phone callback' })
        .expect(201)
      const acts = await prisma.supportTicketAction.findMany({ where: { ticketId } })
      expect(acts.some((a) => a.actionType === 'MFA_RESET')).toBe(true)
    })
  })

  // ─── Rate limiting ────────────────────────────────────────────────────────
  describe('rate limiting', () => {
    it('caps the public locked-out form at 5/IP/hour (6th -> 429)', async () => {
      let last = 0
      for (let i = 0; i < 6; i++) {
        const res = await request(server())
          .post('/v2/support/locked-out')
          .set('X-Forwarded-For', rlIp)
          .send({ email: `rl-${i}@example.com`, description: 'rate-limit probe' })
        last = res.status
      }
      expect(last).toBe(429)
    }, 30000)
  })
})
