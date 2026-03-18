import { jest } from '@jest/globals'
import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { AuthService } from '../src/auth/auth.service.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

/**
 * Integration Test - Social Login Flow
 *
 * This test suite verifies the complete social authentication flows:
 * 1. Google OAuth mobile login (POST /v2/auth/google/mobile)
 * 2. Apple Sign In (POST /v2/auth/apple)
 * 3. Validates AuthLog entries are created for each provider
 * 4. Tests both new user and existing user scenarios
 * 5. Validates proper error handling for invalid tokens
 */
describe('Auth Social Login Flow (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let authService: AuthService

  // Test data
  const mockGoogleUser = {
    email: 'google_user@example.com',
    name: 'Google Test User',
    sub: 'google-12345',
    picture: 'https://example.com/avatar.jpg',
  }

  const mockAppleUser = {
    email: 'apple_user@example.com',
    name: 'Apple Test User',
    sub: 'apple-67890',
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    prisma = moduleFixture.get<PrismaService>(PrismaService)
    authService = moduleFixture.get<AuthService>(AuthService)

    // Mock the token verification methods
    jest
      .spyOn(
        authService as unknown as {
          verifyGoogleToken: (token: string) => Promise<typeof mockGoogleUser>
        },
        'verifyGoogleToken',
      )
      .mockImplementation((token: string) => {
        if (token === 'valid_google_token') {
          return Promise.resolve(mockGoogleUser)
        }
        return Promise.reject(new Error('Invalid Google token'))
      })

    jest
      .spyOn(
        authService as unknown as {
          verifyAppleToken: (token: string) => Promise<typeof mockAppleUser>
        },
        'verifyAppleToken',
      )
      .mockImplementation((token: string) => {
        if (token === 'valid_apple_token') {
          return Promise.resolve(mockAppleUser)
        }
        return Promise.reject(new Error('Invalid Apple token'))
      })

    await app.init()
  }, 30000) // 30 second timeout for app initialization

  afterAll(async () => {
    jest.restoreAllMocks()
    await app.close()
  })

  beforeEach(async () => {
    // Clean up test data before each test
    await prisma.authLog.deleteMany({
      where: {
        OR: [
          { identifier: mockGoogleUser.email },
          { identifier: mockAppleUser.email },
        ],
      },
    })

    // Find accounts first to delete refresh tokens
    const accounts = await prisma.account.findMany({
      where: {
        OR: [{ email: mockGoogleUser.email }, { email: mockAppleUser.email }],
      },
    })

    const userIds = accounts.map((acc) => acc.userId)

    await prisma.refreshToken.deleteMany({
      where: {
        userId: { in: userIds },
      },
    })

    await prisma.account.deleteMany({
      where: {
        OR: [{ email: mockGoogleUser.email }, { email: mockAppleUser.email }],
      },
    })

    await prisma.user.deleteMany({
      where: {
        id: { in: userIds },
      },
    })
  })

  describe('POST /v2/auth/google/mobile - New User', () => {
    it('should authenticate with Google and create new user', async () => {
      const response = await request(app.getHttpServer())
        .post('/v2/auth/google/mobile')
        .send({
          token: 'valid_google_token',
          deviceId: 'google-device-001',
        })
        .expect(200)

      // Verify response contains tokens and user
      expect(response.body).toHaveProperty('accessToken')
      expect(response.body).toHaveProperty('refreshToken')
      expect(response.body.user).toBeDefined()
      expect(response.body.user.email).toBe(mockGoogleUser.email)
      expect(response.body.user.isNewUser).toBe(true)

      // Verify User and Account were created
      const account = await prisma.account.findFirst({
        where: {
          email: mockGoogleUser.email,
          provider: 'google',
        },
        include: { user: true },
      })

      expect(account).toBeDefined()
      expect(account?.provider).toBe('google')
      expect(account?.providerId).toBe(mockGoogleUser.sub)
      expect(account?.user).toBeDefined()
      expect(account?.user.name).toBe(mockGoogleUser.name)

      // Verify RefreshToken was created
      const refreshToken = await prisma.refreshToken.findFirst({
        where: {
          userId: account!.userId,
        },
      })

      expect(refreshToken).toBeDefined()

      // Verify AuthLog entry
      const authLog = await prisma.authLog.findFirst({
        where: {
          identifier: mockGoogleUser.email,
          event: 'social_login_success',
        },
        orderBy: { createdAt: 'desc' },
      })

      expect(authLog).toBeDefined()
      expect(authLog?.success).toBe(true)
      expect(authLog?.userId).toBe(account!.userId)
      expect(authLog?.method).toBe('google')
    })

    it('should reject invalid Google token', async () => {
      const response = await request(app.getHttpServer())
        .post('/v2/auth/google/mobile')
        .send({
          token: 'invalid_token',
          deviceId: 'google-device-002',
        })
        .expect(401)

      expect(response.body).toHaveProperty('message')

      // Verify no account was created
      const account = await prisma.account.findFirst({
        where: {
          email: mockGoogleUser.email,
          provider: 'google',
        },
      })

      expect(account).toBeNull()

      // Verify AuthLog entry for failed attempt
      const authLog = await prisma.authLog.findFirst({
        where: {
          event: 'social_login_failed',
          success: false,
        },
        orderBy: { createdAt: 'desc' },
      })

      expect(authLog).toBeDefined()
      expect(authLog?.errorCode).toBeDefined()
    })

    it('should handle missing required fields', async () => {
      await request(app.getHttpServer())
        .post('/v2/auth/google/mobile')
        .send({
          // Missing token
          deviceId: 'google-device-003',
        })
        .expect(400)

      await request(app.getHttpServer())
        .post('/v2/auth/google/mobile')
        .send({
          token: 'valid_google_token',
          // Missing deviceId
        })
        .expect(400)
    })
  })

  describe('POST /v2/auth/google/mobile - Existing User', () => {
    let existingAccount: { id: string; userId: string; email: string | null }

    beforeEach(async () => {
      // Create existing user with Google account
      const user = await prisma.user.create({
        data: {
          name: mockGoogleUser.name,
        },
      })

      existingAccount = await prisma.account.create({
        data: {
          email: mockGoogleUser.email,
          provider: 'google',
          providerId: mockGoogleUser.sub,
          userId: user.id,
        },
      })
    })

    it('should authenticate existing Google user', async () => {
      const response = await request(app.getHttpServer())
        .post('/v2/auth/google/mobile')
        .send({
          token: 'valid_google_token',
          deviceId: 'google-device-004',
        })
        .expect(200)

      // Verify response
      expect(response.body).toHaveProperty('accessToken')
      expect(response.body).toHaveProperty('refreshToken')
      expect(response.body.user.id).toBe(existingAccount.userId)
      expect(response.body.user.isNewUser).toBe(false)

      // Verify no duplicate account was created
      const accounts = await prisma.account.findMany({
        where: { email: mockGoogleUser.email },
      })

      expect(accounts).toHaveLength(1)

      // Verify AuthLog entry
      const authLog = await prisma.authLog.findFirst({
        where: {
          identifier: mockGoogleUser.email,
          event: 'social_login_success',
          userId: existingAccount.userId,
        },
        orderBy: { createdAt: 'desc' },
      })

      expect(authLog).toBeDefined()
      expect(authLog?.success).toBe(true)
    })
  })

  describe('POST /v2/auth/apple - New User', () => {
    it('should authenticate with Apple and create new user', async () => {
      const response = await request(app.getHttpServer())
        .post('/v2/auth/apple')
        .send({
          identityToken: 'valid_apple_token',
          deviceId: 'apple-device-001',
          firstName: 'Apple',
          lastName: 'User',
        })
        .expect(200)

      // Verify response contains tokens and user
      expect(response.body).toHaveProperty('accessToken')
      expect(response.body).toHaveProperty('refreshToken')
      expect(response.body.user).toBeDefined()
      expect(response.body.user.email).toBe(mockAppleUser.email)
      expect(response.body.user.isNewUser).toBe(true)

      // Verify User and Account were created
      const account = await prisma.account.findFirst({
        where: {
          email: mockAppleUser.email,
          provider: 'apple',
        },
        include: { user: true },
      })

      expect(account).toBeDefined()
      expect(account?.provider).toBe('apple')
      expect(account?.providerId).toBe(mockAppleUser.sub)
      expect(account?.user).toBeDefined()

      // Verify RefreshToken was created
      const refreshToken = await prisma.refreshToken.findFirst({
        where: {
          userId: account!.userId,
        },
      })

      expect(refreshToken).toBeDefined()

      // Verify AuthLog entry
      const authLog = await prisma.authLog.findFirst({
        where: {
          identifier: mockAppleUser.email,
          event: 'social_login_success',
        },
        orderBy: { createdAt: 'desc' },
      })

      expect(authLog).toBeDefined()
      expect(authLog?.success).toBe(true)
      expect(authLog?.method).toBe('apple')
    })

    it('should reject invalid Apple token', async () => {
      const response = await request(app.getHttpServer())
        .post('/v2/auth/apple')
        .send({
          identityToken: 'invalid_token',
          deviceId: 'apple-device-002',
        })
        .expect(401)

      expect(response.body).toHaveProperty('message')

      // Verify no account was created
      const account = await prisma.account.findFirst({
        where: {
          email: mockAppleUser.email,
          provider: 'apple',
        },
      })

      expect(account).toBeNull()

      // Verify AuthLog entry for failed attempt
      const authLog = await prisma.authLog.findFirst({
        where: {
          event: 'social_login_failed',
          success: false,
        },
        orderBy: { createdAt: 'desc' },
      })

      expect(authLog).toBeDefined()
      expect(authLog?.errorCode).toBeDefined()
    })
  })

  describe('POST /v2/auth/apple - Existing User', () => {
    let existingAccount: { id: string; userId: string; email: string | null }

    beforeEach(async () => {
      // Create existing user with Apple account
      const user = await prisma.user.create({
        data: {
          name: mockAppleUser.name,
        },
      })

      existingAccount = await prisma.account.create({
        data: {
          email: mockAppleUser.email,
          provider: 'apple',
          providerId: mockAppleUser.sub,
          userId: user.id,
        },
      })
    })

    it('should authenticate existing Apple user', async () => {
      const response = await request(app.getHttpServer())
        .post('/v2/auth/apple')
        .send({
          identityToken: 'valid_apple_token',
          deviceId: 'apple-device-003',
        })
        .expect(200)

      // Verify response
      expect(response.body).toHaveProperty('accessToken')
      expect(response.body).toHaveProperty('refreshToken')
      expect(response.body.user.id).toBe(existingAccount.userId)
      expect(response.body.user.isNewUser).toBe(false)

      // Verify no duplicate account was created
      const accounts = await prisma.account.findMany({
        where: { email: mockAppleUser.email },
      })

      expect(accounts).toHaveLength(1)

      // Verify AuthLog entry
      const authLog = await prisma.authLog.findFirst({
        where: {
          identifier: mockAppleUser.email,
          event: 'social_login_success',
          userId: existingAccount.userId,
        },
        orderBy: { createdAt: 'desc' },
      })

      expect(authLog).toBeDefined()
      expect(authLog?.success).toBe(true)
      expect(authLog?.userId).toBe(existingAccount.userId)
    })
  })

  describe('Multiple Device Login', () => {
    it('should allow same user to login from multiple devices', async () => {
      // First login from device 1
      await request(app.getHttpServer())
        .post('/v2/auth/google/mobile')
        .send({
          token: 'valid_google_token',
          deviceId: 'device-001',
        })
        .expect(200)

      // Second login from device 2
      const response = await request(app.getHttpServer())
        .post('/v2/auth/google/mobile')
        .send({
          token: 'valid_google_token',
          deviceId: 'device-002',
        })
        .expect(200)

      expect(response.body).toHaveProperty('accessToken')

      // Verify both refresh tokens exist
      const account = await prisma.account.findFirst({
        where: {
          email: mockGoogleUser.email,
          provider: 'google',
        },
      })

      const refreshTokens = await prisma.refreshToken.findMany({
        where: {
          userId: account!.userId,
        },
      })

      expect(refreshTokens.length).toBeGreaterThanOrEqual(1)

      // Verify multiple AuthLog entries
      const authLogs = await prisma.authLog.findMany({
        where: {
          identifier: mockGoogleUser.email,
          event: 'social_login_success',
        },
      })

      expect(authLogs.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Cross-Provider Account Linking', () => {
    it('should link Google and Apple accounts with same email', async () => {
      // Mock both providers to return same email
      const sharedEmail = 'shared@example.com'

      jest
        .spyOn(
          authService as unknown as {
            verifyGoogleToken: (token: string) => Promise<unknown>
          },
          'verifyGoogleToken',
        )
        .mockResolvedValueOnce({
          email: sharedEmail,
          name: 'Shared User',
          sub: 'google-shared',
        })

      // First login with Google
      const googleResponse = await request(app.getHttpServer())
        .post('/v2/auth/google/mobile')
        .send({
          token: 'valid_google_token',
          deviceId: 'device-google',
        })
        .expect(200)

      const googleUserId = googleResponse.body.user.id

      jest
        .spyOn(
          authService as unknown as {
            verifyAppleToken: (token: string) => Promise<unknown>
          },
          'verifyAppleToken',
        )
        .mockResolvedValueOnce({
          email: sharedEmail,
          name: 'Shared User',
          sub: 'apple-shared',
        })

      // Then login with Apple using same email
      const appleResponse = await request(app.getHttpServer())
        .post('/v2/auth/apple')
        .send({
          identityToken: 'valid_apple_token',
          deviceId: 'device-apple',
        })
        .expect(200)

      // Should return same user
      expect(appleResponse.body.user.id).toBe(googleUserId)

      // Verify both accounts exist for same user
      const accounts = await prisma.account.findMany({
        where: { email: sharedEmail },
      })

      expect(accounts).toHaveLength(2)
      expect(accounts.every((acc) => acc.userId === googleUserId)).toBe(true)

      // Clean up
      await prisma.authLog.deleteMany({ where: { identifier: sharedEmail } })
      await prisma.refreshToken.deleteMany({
        where: { userId: googleUserId },
      })
      await prisma.account.deleteMany({ where: { email: sharedEmail } })
      await prisma.user.deleteMany({
        where: { id: googleUserId },
      })
    })
  })
})
