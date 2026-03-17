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
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    prisma = moduleFixture.get<PrismaService>(PrismaService)
    await app.init()
  }, 30000) // 30 second timeout for app initialization

  afterAll(async () => {
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

    it('should replace existing OTP when sending new one', async () => {
      // Send first OTP
      await request(app.getHttpServer())
        .post('/v2/auth/otp/send')
        .send({ email: testEmail })
        .expect(200)

      const firstOtp = await prisma.otpCode.findFirst({
        where: { email: testEmail },
      })

      // Wait a moment to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Send second OTP
      await request(app.getHttpServer())
        .post('/v2/auth/otp/send')
        .send({ email: testEmail })
        .expect(200)

      const secondOtp = await prisma.otpCode.findFirst({
        where: { email: testEmail },
      })

      // Should be replaced, not duplicated
      expect(secondOtp).toBeDefined()
      expect(secondOtp?.codeHash).not.toBe(firstOtp?.codeHash)
      expect(secondOtp?.createdAt.getTime()).toBeGreaterThan(
        firstOtp!.createdAt.getTime(),
      )

      // Should have 2 AuthLog entries
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
})
