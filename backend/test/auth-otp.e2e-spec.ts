import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

/**
 *Integration Test - Full OTP Flow
 *
 * This test suite verifies the OTP authentication endpoints and AuthLog creation.
 *
 * NOTE: Full end-to-end OTP verification tests require either:
 * 1. A test mode that returns the OTP in the response (not implemented for security)
 * 2. Email interception in test environment
 * 3. Mocking the OTP generation at service level
 *
 * Current tests focus on:
 * - OTP send functionality and rate limiting
 * - AuthLog creation for OTP events
 * - Error handling and validation
 * - Database state management (OtpCode creation/deletion)
 */
describe('Auth OTP Flow (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  const testEmail = 'test-otp@example.com' // Test email

  beforeAll(async () => {
    // V-03 (2026-07-17) — auth endpoints are now rate limited (5/60s per
    // ip:email on otp/send + otp/verify). This suite drives ~15 calls against
    // ONE shared testEmail from one host, and deliberately loops otp/verify to
    // prove the OtpCode lockout — so the limiter would trip mid-suite. The
    // beforeEach below cannot help: it truncates tables, but the throttler
    // counts in an in-memory Map that no DB cleanup can reach.
    //
    // The flag is double-gated and ignored when NODE_ENV=production
    // (auth-throttler.guard.ts), so it cannot weaken a real deployment. The
    // limiter itself is proven by the "V-03 rate limiting" block at the bottom
    // of this file, which turns it back on for its own unique email.
    process.env.AUTH_THROTTLE_DISABLED = '1'

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    prisma = moduleFixture.get<PrismaService>(PrismaService)
    await app.init()
  }, 30000) // 30 second timeout for app initialization

  afterAll(async () => {
    delete process.env.AUTH_THROTTLE_DISABLED
    await app.close()
  })

  beforeEach(async () => {
    // Clean up test data before each test
    await prisma.authLog.deleteMany({
      where: { identifier: testEmail },
    })
    await prisma.otpCode.deleteMany({
      where: { email: testEmail },
    })

    // Find accounts to get user IDs for cascade deletion
    const accounts = await prisma.account.findMany({
      where: { email: testEmail },
    })
    const userIds = accounts.map((acc) => acc.userId)

    await prisma.refreshToken.deleteMany({
      where: {
        userId: { in: userIds },
      },
    })
    await prisma.account.deleteMany({
      where: { email: testEmail },
    })
    await prisma.user.deleteMany({
      where: {
        id: { in: userIds },
      },
    })
  })

  describe('POST /v2/auth/otp/send', () => {
    it('should send OTP and create OtpCode record', async () => {
      const response = await request(app.getHttpServer())
        .post('/v2/auth/otp/send')
        .send({ email: testEmail })
        .expect(200)

      expect(response.body).toHaveProperty('message')

      // Verify OtpCode was created in database
      const otpRecord = await prisma.otpCode.findFirst({
        where: { email: testEmail },
      })

      expect(otpRecord).toBeDefined()
      expect(otpRecord?.email).toBe(testEmail)
      expect(otpRecord?.codeHash).toBeDefined()
      expect(otpRecord?.attempts).toBe(0)
      expect(otpRecord?.expiresAt.getTime()).toBeGreaterThan(Date.now())

      // Verify AuthLog entry was created
      const authLog = await prisma.authLog.findFirst({
        where: {
          identifier: testEmail,
          event: 'otp_requested',
        },
        orderBy: { createdAt: 'desc' },
      })

      expect(authLog).toBeDefined()
      expect(authLog?.success).toBe(true)
    })

    /**
     * Rewritten 2026-07-17. This was titled "should replace existing OTP when
     * sending new one" and was BROKEN two ways — it contradicted the test at
     * "should prevent sending OTP twice within 60 seconds" below, which sends
     * the same two requests and (correctly) expects the second to 400:
     *
     *  1. UNREACHABLE — it slept 100 ms and expected the second send to 200,
     *     but the cooldown rejects any send within 60 s of the last OTP for
     *     that email (auth.service.ts, "Please wait 60 seconds…"). The second
     *     send always 400s, so the test could never pass. Nobody noticed: this
     *     suite is not in CI (only text-chat / voice-chat e2e are).
     *  2. WRONG PREMISE — nothing is "replaced". `sendOtp` only INSERTs; no
     *     delete of prior rows exists. `verifyOtp` simply takes the newest via
     *     `orderBy: { createdAt: 'desc' }` and older rows linger until they
     *     expire. The old assertion also used `findFirst` with NO `orderBy`,
     *     so which row it read was arbitrary.
     *
     * Now tests the behaviour that actually exists: past the cooldown, a fresh
     * send adds a NEWER code, and the newest is the one verification will use.
     */
    it('a new OTP supersedes the previous one once the cooldown has passed', async () => {
      await request(app.getHttpServer())
        .post('/v2/auth/otp/send')
        .send({ email: testEmail })
        .expect(200)

      const firstOtp = await prisma.otpCode.findFirst({
        where: { email: testEmail },
        orderBy: { createdAt: 'desc' },
      })
      expect(firstOtp).toBeDefined()

      // Age the first code past the 60s cooldown instead of sleeping 60s. This
      // makes the real behaviour reachable; it does not weaken the check — the
      // cooldown itself is asserted by its own test below.
      await prisma.otpCode.update({
        where: { id: firstOtp!.id },
        data: { createdAt: new Date(Date.now() - 61_000) },
      })

      await request(app.getHttpServer())
        .post('/v2/auth/otp/send')
        .send({ email: testEmail })
        .expect(200)

      // Newest wins — this is the row verifyOtp will pick.
      const newest = await prisma.otpCode.findFirst({
        where: { email: testEmail },
        orderBy: { createdAt: 'desc' },
      })

      expect(newest).toBeDefined()
      expect(newest?.id).not.toBe(firstOtp!.id)
      expect(newest?.codeHash).not.toBe(firstOtp!.codeHash)
      expect(newest!.createdAt.getTime()).toBeGreaterThan(
        firstOtp!.createdAt.getTime(),
      )

      const authLogs = await prisma.authLog.findMany({
        where: {
          identifier: testEmail,
          event: 'otp_requested',
        },
      })

      expect(authLogs).toHaveLength(2)
    })

    it('should reject invalid phone number format', async () => {
      await request(app.getHttpServer())
        .post('/v2/auth/otp/send')
        .send({ email: 'invalid' })
        .expect(400)
    })
  })

  describe('POST /v2/auth/otp/verify - Error Cases', () => {
    beforeEach(async () => {
      // Send OTP first to create an OtpCode record
      await request(app.getHttpServer())
        .post('/v2/auth/otp/send')
        .send({ email: testEmail })
        .expect(200)
    })

    it('should reject invalid OTP code and increment attempts', async () => {
      const response = await request(app.getHttpServer())
        .post('/v2/auth/otp/verify')
        .send({
          email: testEmail,
          otp: '000000', // Wrong code
          deviceId: 'test-device-001',
        })
        .expect(401)

      expect(response.body).toHaveProperty('message')

      // Verify OtpCode still exists but attempts incremented
      const otpRecord = await prisma.otpCode.findFirst({
        where: { email: testEmail },
      })

      expect(otpRecord).toBeDefined()
      expect(otpRecord?.attempts).toBe(1)

      // Verify AuthLog entry for failed attempt
      const authLog = await prisma.authLog.findFirst({
        where: {
          identifier: testEmail,
          event: 'otp_failed',
        },
      })

      expect(authLog).toBeDefined()
      expect(authLog?.success).toBe(false)
    })

    it('should reject after max attempts (5) and delete OTP', async () => {
      // Make 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/v2/auth/otp/verify')
          .send({
            email: testEmail,
            otp: '000000',
            deviceId: 'test-device-001',
          })
          .expect(401)
      }

      // Verify OtpCode was deleted after max attempts
      const otpRecord = await prisma.otpCode.findFirst({
        where: { email: testEmail },
      })
      expect(otpRecord).toBeNull()

      // Verify AuthLog entries (should have 5 otp_failed entries)
      const failedLogs = await prisma.authLog.findMany({
        where: {
          identifier: testEmail,
          event: 'otp_failed',
        },
      })

      expect(failedLogs.length).toBeGreaterThanOrEqual(5)

      // Verify final otp_locked event
      const lockedLog = await prisma.authLog.findFirst({
        where: {
          identifier: testEmail,
          event: 'otp_locked',
        },
      })
      expect(lockedLog).toBeDefined()
      expect(lockedLog?.success).toBe(false)
    })

    it('should reject expired OTP', async () => {
      // Manually expire the OTP - find it first then update by id
      const otpToExpire = await prisma.otpCode.findFirst({
        where: { email: testEmail },
      })

      if (otpToExpire) {
        await prisma.otpCode.update({
          where: { id: otpToExpire.id },
          data: { expiresAt: new Date(Date.now() - 1000) }, // 1 second ago
        })
      }

      const response = await request(app.getHttpServer())
        .post('/v2/auth/otp/verify')
        .send({
          email: testEmail,
          otp: '123456',
          deviceId: 'test-device-001',
        })
        .expect(401)

      expect(response.body.message).toContain('expired')

      // Verify AuthLog entry
      const authLog = await prisma.authLog.findFirst({
        where: {
          identifier: testEmail,
          event: 'otp_expired',
        },
      })

      expect(authLog).toBeDefined()
      expect(authLog?.success).toBe(false)
    })

    it('should reject when OTP does not exist', async () => {
      const response = await request(app.getHttpServer())
        .post('/v2/auth/otp/verify')
        .send({
          email: 'nonexistent@example.com',
          otp: '123456',
          deviceId: 'test-device-001',
        })
        .expect(401)

      expect(response.body).toHaveProperty('message')
    })

    it('should reject missing required fields', async () => {
      await request(app.getHttpServer())
        .post('/v2/auth/otp/verify')
        .send({
          // Missing email
          otp: '123456',
          deviceId: 'test-device-001',
        })
        .expect(400)

      await request(app.getHttpServer())
        .post('/v2/auth/otp/verify')
        .send({
          email: testEmail,
          // Missing otp
          deviceId: 'test-device-001',
        })
        .expect(400)
    })
  })

  describe('Rate Limiting', () => {
    it('should prevent sending OTP twice within 60 seconds', async () => {
      // Send first OTP
      await request(app.getHttpServer())
        .post('/v2/auth/otp/send')
        .send({ email: testEmail })
        .expect(200)

      // Try to send again immediately
      const response = await request(app.getHttpServer())
        .post('/v2/auth/otp/send')
        .send({ email: testEmail })
        .expect(400)

      expect(response.body.message).toContain('60 seconds')
    })
  })
  /**
   * V-03 (Humaira assessment 2026-07-14, CRITICAL) — "Authentication endpoints
   * have no rate limiting (throttler configured but never enforced)".
   *
   * The rest of this suite runs with AUTH_THROTTLE_DISABLED=1 (see beforeAll),
   * so these tests re-arm the limiter for themselves. Each uses its OWN email:
   * buckets are keyed ip:email, so a dedicated address both isolates this block
   * from the shared testEmail and keeps its own two tests from colliding.
   */
  describe('V-03 rate limiting', () => {
    beforeAll(() => {
      delete process.env.AUTH_THROTTLE_DISABLED
    })
    afterAll(() => {
      process.env.AUTH_THROTTLE_DISABLED = '1'
    })

    // Fresh address per run so a previous run's in-memory bucket (which no DB
    // cleanup can clear) cannot make this pass or fail spuriously.
    const throttleEmail = () => `throttle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`

    it('otp/verify → 429 once the 5/60s budget is spent', async () => {
      const email = throttleEmail()

      // 5 allowed. They 400/401 on their own merits (no OTP exists) — the point
      // is only that they are not rejected BY THE LIMITER.
      for (let i = 0; i < 5; i++) {
        const res = await request(app.getHttpServer())
          .post('/v2/auth/otp/verify')
          .send({ email, otp: '000000', deviceId: 'throttle-test-device' })
        expect(res.status).not.toBe(429)
      }

      // 6th — this is the assertion the whole finding is about.
      await request(app.getHttpServer())
        .post('/v2/auth/otp/verify')
        .send({ email, otp: '000000', deviceId: 'throttle-test-device' })
        .expect(429)
    })

    it('otp/send → 429 once the 5/60s budget is spent', async () => {
      const email = throttleEmail()

      // The 60s per-email cooldown 400s sends 2..5; that is a different control
      // and does not consume the throttler differently — every request counts.
      for (let i = 0; i < 5; i++) {
        const res = await request(app.getHttpServer())
          .post('/v2/auth/otp/send')
          .send({ email })
        expect(res.status).not.toBe(429)
      }

      await request(app.getHttpServer())
        .post('/v2/auth/otp/send')
        .send({ email })
        .expect(429)
    })

    it('a DIFFERENT email is a different bucket (keying is ip:email, not ip)', async () => {
      const victim = throttleEmail()

      for (let i = 0; i < 6; i++) {
        await request(app.getHttpServer())
          .post('/v2/auth/otp/verify')
          .send({ email: victim, otp: '000000', deviceId: 'throttle-test-device' })
      }
      // victim is now throttled.
      await request(app.getHttpServer())
        .post('/v2/auth/otp/verify')
        .send({ email: victim, otp: '000000', deviceId: 'throttle-test-device' })
        .expect(429)

      // A bystander on the same IP must still be able to sign in — otherwise
      // one attacker could lock out an entire NAT'd clinic.
      const bystander = throttleEmail()
      const res = await request(app.getHttpServer())
        .post('/v2/auth/otp/verify')
        .send({ email: bystander, otp: '000000', deviceId: 'throttle-test-device' })
      expect(res.status).not.toBe(429)
    })
  })
})
