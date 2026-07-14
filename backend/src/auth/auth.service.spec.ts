// @ts-nocheck
import { jest } from '@jest/globals'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test, TestingModule } from '@nestjs/testing'
import { validate } from 'class-validator'
import { TRAINING_ACK_VERSION } from '@cardioplace/shared'
import {
  AccountStatus,
  CommunicationPreference,
  OnboardingStatus,
  UserRole,
} from '../generated/prisma/enums.js'
import { EmailService } from '../email/email.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { AuthService } from './auth.service.js'
import { BcryptService } from './bcrypt.service.js'
import { DisplayIdService } from '../users/display-id.service.js'
import { GeolocationService } from './geolocation.service.js'
import { MfaService } from './mfa.service.js'
import { WebAuthnService } from './webauthn.service.js'
import { ProfileDto } from './dto/profile.dto.js'

// Type for spying on private methods in tests
type AuthServiceWithPrivateMethods = AuthService & {
  issueTokenPair: (...args: unknown[]) => Promise<unknown>
}

describe('AuthService', () => {
  let service: AuthService
  let prisma: PrismaService
  let bcryptService: BcryptService
  // Phase/practice-identity — selectPractice unit tests poke verifyAsync.
  let jwtService: JwtService

  // Mock data
  const mockUser = {
    id: '01JCEXAMPLE123456789',
    email: 'test@example.com',
    name: 'Test User',
    roles: [UserRole.PATIENT],
    isVerified: true,
    onboardingStatus: OnboardingStatus.COMPLETED,
    accountStatus: AccountStatus.ACTIVE,
    dateOfBirth: null,
    communicationPreference: null,
    preferredLanguage: 'en',
    timezone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockOtpCode = {
    id: '01JCEXAMPLE123456789',
    email: 'test@example.com',
    codeHash: 'hashed_code',
    expiresAt: new Date(Date.now() + 600000), // 10 minutes
    attempts: 0,
    createdAt: new Date(),
  }

  const mockContext = {
    deviceId: 'device-123',
    ipAddress: '192.168.1.1',
    userAgent: 'Mozilla/5.0',
  }

  beforeEach(async () => {
    // June 2026 — issueRefreshToken / rotateRefreshToken / revoke now wrap
    // the RefreshToken + AuthSession writes in a single transaction. The
    // callback form receives the Prisma client; for tests we just pass
    // the mock straight through so the inner calls land on the same
    // jest mocks. AuthSession.findMany defaults to [] so enforceSessionLimit
    // sees "no prior sessions" and skips eviction unless a test overrides.
    const prismaMock: Record<string, unknown> = {
      authLog: {
        create: jest.fn(),
        findFirst: jest.fn(),
      },
      otpCode: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      authSession: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      account: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      device: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      userDevice: {
        findFirst: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
      },
      // June 2026 — phase/practice-identity. Mock for resolvePracticeContext +
      // selectPractice + switchPractice membership lookups. Tests override
      // per-case (findMany for resolve, findUnique for select/switch).
      practiceProvider: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
      // June 2026 — COORDINATOR practice attribution. Their membership lives
      // on the 1:1 PracticeCoordinator relation, not PracticeProvider.
      practiceCoordinator: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      // PR #90 — a MEDICAL_DIRECTOR's practice membership lives on
      // PracticeMedicalDirector; resolvePracticeContext + isPracticeMember probe
      // it so an MD who heads a practice (but isn't a provider-member) isn't
      // blocked at sign-in / select-practice / switch-practice.
      practiceMedicalDirector: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      // MFA (Manisha 2026-06-12 §6). shouldChallengeMfa reads totpCredential
      // on the verifyOtp/selectPractice paths; default null = not enrolled =
      // no challenge, preserving existing sign-in test behavior.
      totpCredential: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
      mfaRecoveryCode: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        update: jest.fn(),
      },
      // WebAuthn (patient biometric). Default count 0 = no registered device =
      // no biometric challenge, preserving existing patient sign-in behavior.
      webAuthnCredential: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
    }
    prismaMock.$transaction = jest
      .fn()
      .mockImplementation(async (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: unknown) => Promise<unknown>)(prismaMock)
        }
        return Promise.all(arg as Promise<unknown>[])
      })

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest
              .fn<() => Promise<string>>()
              .mockResolvedValue('mock.jwt.token'),
            // Phase/practice-identity — selectPractice round-trips the
            // challenge token via verifyAsync. Default to a happy-path
            // PROVIDER subject; individual tests override per-case.
            verifyAsync: jest
              .fn<() => Promise<unknown>>()
              .mockResolvedValue({ sub: 'user-prov', kind: 'practice_select' }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              const config: Record<string, string> = {
                JWT_ACCESS_EXPIRES_IN: '15m',
                JWT_REFRESH_EXPIRES_IN: '30d',
                GOOGLE_CLIENT_ID: 'mock-google-client-id',
                APPLE_CLIENT_ID: 'mock-apple-client-id',
                SMTP_HOST: 'smtp.example.com',
                SMTP_PORT: '587',
                SMTP_USER: 'test@example.com',
                SMTP_PASS: 'test-smtp-pass',
                SMTP_FROM: 'Cardioplace <no-reply@example.com>',
              }
              return config[key] ?? defaultValue
            }),
          },
        },
        {
          provide: BcryptService,
          useValue: {
            hash: jest.fn(),
            compare: jest.fn(),
          },
        },
        {
          provide: EmailService,
          useValue: {
            sendOtp: jest.fn(),
          },
        },
        {
          provide: GeolocationService,
          useValue: {
            // Defaults: same geohash + UNKNOWN country → no anomaly.
            // Individual tests override via jest.spyOn(geo, ...).
            computeGeohash: jest.fn((ip: string | null) => (ip ? `gh-${ip}` : null)),
            lookupCountry: jest.fn(() => 'UNKNOWN'),
            isAnomaly: jest.fn(
              (stored: string | null, current: string | null) =>
                !!stored && !!current && stored !== current,
            ),
          },
        },
        {
          provide: MfaService,
          useValue: {
            generateSecret: jest.fn(() => 'MOCKSECRET'),
            buildProvisioningUri: jest.fn(() => 'otpauth://totp/mock'),
            buildQrDataUrl: jest.fn(async () => 'data:image/png;base64,mock'),
            verifyCode: jest.fn(() => true),
            encryptSecret: jest.fn((s: string) => `enc(${s})`),
            decryptSecret: jest.fn((e: string) => e),
            generateRecoveryCodes: jest.fn(async () => ({
              plain: ['AAAAA-11111'],
              hashes: ['hash-AAAAA11111'],
            })),
            verifyRecoveryCode: jest.fn(async () => false),
          },
        },
        {
          provide: WebAuthnService,
          useValue: {
            randomChallenge: jest.fn(() => 'mock-challenge'),
            buildRegistrationOptions: jest.fn(async () => ({})),
            verifyRegistration: jest.fn(async () => ({ verified: false })),
            buildAuthenticationOptions: jest.fn(async () => ({})),
            verifyAuthentication: jest.fn(async () => ({ verified: false })),
            encodePublicKey: jest.fn(() => 'mock-pubkey'),
            decodePublicKey: jest.fn(() => new Uint8Array()),
          },
        },
        {
          // Stub that returns a deterministic canonical value so any spec
          // that creates a user gets a stable displayId in the mock.
          provide: DisplayIdService,
          useValue: {
            issue: jest.fn(async () => ({
              value: 'CPPATTESTING0',
              display: 'CP-PAT-TESTING-0',
            })),
            // issueForCreate is a higher-order helper: it generates a displayId
            // and runs the caller's create closure with it, returning the created
            // row. Invoke the closure so the underlying tx.user.create still fires.
            issueForCreate: jest.fn(
              async (
                _tx: unknown,
                _cls: unknown,
                _via: unknown,
                createUserFn: (displayId: string) => Promise<unknown>,
              ) => createUserFn('CPPATTESTING0'),
            ),
          },
        },
      ],
    }).compile()

    service = module.get<AuthService>(AuthService)
    prisma = module.get<PrismaService>(PrismaService)
    bcryptService = module.get<BcryptService>(BcryptService)
    jwtService = module.get<JwtService>(JwtService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('TASK-16: logAuthEvent', () => {
    it('should successfully log auth event with all fields', async () => {
      const mockAuthLog = {
        id: '01JCEXAMPLE123456789',
        event: 'otp_verified',
        identifier: 'test@example.com',
        userId: mockUser.id,
        method: 'otp',
        deviceId: 'device-123',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        metadata: { attempts: 1 },
        success: true,
        errorCode: null,
        createdAt: new Date(),
      }

      ;(prisma.authLog.create as jest.Mock).mockResolvedValue(mockAuthLog)

      await (
        service as unknown as {
          logAuthEvent: (params: Record<string, unknown>) => Promise<void>
        }
      ).logAuthEvent({
        event: 'otp_verified',
        identifier: 'test@example.com',
        userId: mockUser.id,
        method: 'otp',
        deviceId: 'device-123',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        metadata: { attempts: 1 },
        success: true,
      })

      expect(prisma.authLog.create).toHaveBeenCalledWith({
        data: {
          event: 'otp_verified',
          identifier: 'test@example.com',
          userId: mockUser.id,
          method: 'otp',
          deviceId: 'device-123',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          metadata: { attempts: 1 },
          success: true,
          errorCode: null,
          practiceContext: null,
        },
      })
    })

    it('should log auth event with minimal required fields', async () => {
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})

      await (
        service as unknown as {
          logAuthEvent: (params: Record<string, unknown>) => Promise<void>
        }
      ).logAuthEvent({
        event: 'otp_requested',
        success: true,
      })

      expect(prisma.authLog.create).toHaveBeenCalledWith({
        data: {
          event: 'otp_requested',
          identifier: null,
          userId: null,
          method: null,
          deviceId: null,
          ipAddress: null,
          userAgent: null,
          metadata: null,
          success: true,
          errorCode: null,
          practiceContext: null,
        },
      })
    })

    it('should log auth event with error code on failure', async () => {
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})

      await (
        service as unknown as {
          logAuthEvent: (params: Record<string, unknown>) => Promise<void>
        }
      ).logAuthEvent({
        event: 'otp_failed',
        identifier: 'test@example.com',
        method: 'otp',
        success: false,
        errorCode: 'invalid_code',
      })

      expect(prisma.authLog.create).toHaveBeenCalledWith({
        data: {
          event: 'otp_failed',
          identifier: 'test@example.com',
          userId: null,
          method: 'otp',
          deviceId: null,
          ipAddress: null,
          userAgent: null,
          metadata: null,
          success: false,
          errorCode: 'invalid_code',
          practiceContext: null,
        },
      })
    })

    it('should handle database error gracefully and not throw', async () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {
          /* intentionally empty */
        })
      ;(prisma.authLog.create as jest.Mock).mockRejectedValue(
        new Error('Database connection failed'),
      )

      await expect(
        (
          service as unknown as {
            logAuthEvent: (params: Record<string, unknown>) => Promise<void>
          }
        ).logAuthEvent({
          event: 'otp_verified',
          success: true,
        }),
      ).resolves.not.toThrow()

      // N1 (2026-07-08) — logAuthEvent no longer console.errors a two-arg
      // ("prefix", Error) tuple. It now delegates to writeAuditWithRetry,
      // which on retry exhaustion emits a SINGLE JSON string carrying
      // `{audit_write_failed: true, kind: "auth-log", error_name, error_message, ...}`.
      // Log aggregators (CloudWatch, Loki) index on `audit_write_failed`
      // for alerting; the test is updated to assert on the new shape.
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
      const logged = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
      expect(logged).toMatchObject({
        audit_write_failed: true,
        kind: 'auth-log',
        error_name: 'Error',
        error_message: 'Database connection failed',
        'audit.event': 'otp_verified',
      })

      consoleErrorSpy.mockRestore()
    })

    it('should handle metadata JSON serialization correctly', async () => {
      const complexMetadata = {
        providerId: 'google-123',
        emailVerified: true,
        nested: { key: 'value' },
        array: [1, 2, 3],
      }

      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})

      await (
        service as unknown as {
          logAuthEvent: (params: Record<string, unknown>) => Promise<void>
        }
      ).logAuthEvent({
        event: 'social_login_success',
        metadata: complexMetadata,
        success: true,
      })

      expect(prisma.authLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: complexMetadata,
        }),
      })
    })

    it('should log pre-auth events with identifier only', async () => {
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})

      await (
        service as unknown as {
          logAuthEvent: (params: Record<string, unknown>) => Promise<void>
        }
      ).logAuthEvent({
        event: 'otp_requested',
        identifier: 'test@example.com',
        method: 'otp',
        success: true,
      })

      expect(prisma.authLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: 'otp_requested',
          identifier: 'test@example.com',
          userId: null,
        }),
      })
    })

    it('should log post-auth events with userId', async () => {
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})

      await (
        service as unknown as {
          logAuthEvent: (params: Record<string, unknown>) => Promise<void>
        }
      ).logAuthEvent({
        event: 'logout',
        userId: mockUser.id,
        success: true,
      })

      expect(prisma.authLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: 'logout',
          userId: mockUser.id,
        }),
      })
    })
  })

  describe('training-ack (HIPAA L1 — Rules-of-Behavior acknowledgment)', () => {
    it('recordTrainingAck writes a training_acknowledged AuthLog event with the current ROB version', async () => {
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})

      const res = await service.recordTrainingAck('user-1', {
        ipAddress: '1.1.1.1',
        userAgent: 'UA',
      })

      expect(res).toEqual({ recorded: true, version: TRAINING_ACK_VERSION })
      expect(prisma.authLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: 'training_acknowledged',
          userId: 'user-1',
          success: true,
          metadata: expect.objectContaining({
            policyType: 'RULES_OF_BEHAVIOR',
            version: TRAINING_ACK_VERSION,
            via: 'audit-console',
          }),
        }),
      })
    })

    it('getTrainingAckStatus → acknowledged when the latest event matches the current version', async () => {
      const ackedAt = new Date('2026-07-06T00:00:00.000Z')
      ;(prisma.authLog.findFirst as jest.Mock).mockResolvedValue({
        createdAt: ackedAt,
        metadata: { version: TRAINING_ACK_VERSION },
      })

      const status = await service.getTrainingAckStatus('user-1')

      expect(status).toEqual({
        acknowledged: true,
        version: TRAINING_ACK_VERSION,
        ackedAt,
      })
    })

    it('getTrainingAckStatus → NOT acknowledged for a stale (older) ROB version', async () => {
      ;(prisma.authLog.findFirst as jest.Mock).mockResolvedValue({
        createdAt: new Date(),
        metadata: { version: 'an-older-version' },
      })

      const status = await service.getTrainingAckStatus('user-1')

      expect(status.acknowledged).toBe(false)
      expect(status.ackedAt).toBeNull()
    })

    it('getTrainingAckStatus → NOT acknowledged when no acknowledgment exists', async () => {
      ;(prisma.authLog.findFirst as jest.Mock).mockResolvedValue(null)

      const status = await service.getTrainingAckStatus('user-1')

      expect(status.acknowledged).toBe(false)
      expect(status.ackedAt).toBeNull()
    })
  })

  describe('TASK-17: verifyOtp - Success Path', () => {
    it('should verify OTP successfully, delete OtpCode, and log event', async () => {
      const otpCode = { ...mockOtpCode }
      ;(bcryptService.compare as jest.Mock).mockResolvedValue(true)
      ;(bcryptService.hash as jest.Mock).mockResolvedValue(
        'hashed_refresh_token',
      )
      ;(prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)
      ;(prisma.otpCode.delete as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        tokenHash: 'hash',
        expiresAt: new Date(),
      })

      const result = await service.verifyOtp(
        'test@example.com',
        '123456',
        mockContext,
      )

      expect(prisma.otpCode.delete).toHaveBeenCalledWith({
        where: { id: otpCode.id },
      })

      expect(prisma.authLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: 'otp_verified',
          identifier: 'test@example.com',
          userId: mockUser.id,
          method: 'otp',
          success: true,
        }),
      })

      expect(result).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        onboarding_required: false,
        login_method: 'otp',
      })
    })

    it('should create new user if email not found', async () => {
      const otpCode = { ...mockOtpCode }
      ;(bcryptService.compare as jest.Mock).mockResolvedValue(true)
      ;(bcryptService.hash as jest.Mock).mockResolvedValue(
        'hashed_refresh_token',
      )
      ;(prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)
      ;(prisma.user.create as jest.Mock).mockResolvedValue(mockUser)
      ;(prisma.otpCode.delete as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        tokenHash: 'hash',
        expiresAt: new Date(),
      })

      await service.verifyOtp('test@example.com', '123456', mockContext)

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          isVerified: true,
          roles: [UserRole.PATIENT],
          // user INSERT now routes through DisplayIdService.issueForCreate, so the
          // pre-generated displayId is part of the create payload.
          displayId: expect.any(String),
        },
      })
    })

    it('should update isVerified if user exists but not verified', async () => {
      const unverifiedUser = { ...mockUser, isVerified: false }
      const otpCode = { ...mockOtpCode }
      ;(bcryptService.compare as jest.Mock).mockResolvedValue(true)
      ;(bcryptService.hash as jest.Mock).mockResolvedValue(
        'hashed_refresh_token',
      )
      ;(prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(unverifiedUser)
      ;(prisma.user.update as jest.Mock).mockResolvedValue({
        ...unverifiedUser,
        isVerified: true,
      })
      ;(prisma.otpCode.delete as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        tokenHash: 'hash',
        expiresAt: new Date(),
      })

      await service.verifyOtp('test@example.com', '123456', mockContext)

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: unverifiedUser.id },
        data: { isVerified: true },
      })
    })
  })

  // Practice-chip hydration race (2026-06-25): every auth-issuing response must
  // ship the resolved practice bundle (activePractice + availablePractices) so
  // the admin chip renders on first paint without waiting for /auth/profile.
  describe('verifyOtp — practice bundle in response (chip hydration fix)', () => {
    const armOtp = () => {
      ;(bcryptService.compare as jest.Mock).mockResolvedValue(true)
      ;(bcryptService.hash as jest.Mock).mockResolvedValue('hashed_refresh_token')
      ;(prisma.otpCode.findFirst as jest.Mock).mockResolvedValue({ ...mockOtpCode })
      ;(prisma.otpCode.delete as jest.Mock).mockResolvedValue({})
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        tokenHash: 'hash',
        expiresAt: new Date(),
      })
    }

    it('single-practice PROVIDER → response carries activePractice + availablePractices', async () => {
      armOtp()
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockUser,
        roles: [UserRole.PROVIDER],
      })
      ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([
        { practiceId: 'p-a', practice: { id: 'p-a', name: 'Cedar Hill' } },
      ])

      const result = await service.verifyOtp('test@example.com', '123456', mockContext)

      expect(result).toMatchObject({
        activePracticeId: 'p-a',
        activePractice: { id: 'p-a', name: 'Cedar Hill' },
        availablePractices: [{ id: 'p-a', name: 'Cedar Hill' }],
      })
    })

    it('org-wide SUPER_ADMIN → activePractice null + availablePractices [] (never queries memberships)', async () => {
      armOtp()
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockUser,
        roles: [UserRole.SUPER_ADMIN],
      })

      const result = await service.verifyOtp('test@example.com', '123456', mockContext)

      expect(result).toMatchObject({
        activePracticeId: null,
        activePractice: null,
        availablePractices: [],
      })
      expect(prisma.practiceProvider.findMany).not.toHaveBeenCalled()
    })
  })

  describe('mfaChallenge — practice bundle in response (chip hydration fix)', () => {
    it('enrolled provider → carries activePractice + availablePractices', async () => {
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})
      ;(prisma.authLog as unknown as { count: jest.Mock }).count = jest
        .fn()
        .mockResolvedValue(0)
      ;(bcryptService.hash as jest.Mock).mockResolvedValue('hashed_refresh_token')
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        tokenHash: 'hash',
        expiresAt: new Date(),
      })
      ;(jwtService.verifyAsync as jest.Mock).mockResolvedValueOnce({
        sub: 'user-prov',
        kind: 'mfa_challenge',
        activePracticeId: 'p-a',
      })
      ;(prisma.totpCredential.findUnique as jest.Mock).mockResolvedValue({
        secretEncrypted: 'enc-secret',
        enrolledAt: new Date(),
      })
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockUser,
        id: 'user-prov',
        roles: [UserRole.PROVIDER],
      })
      ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([
        { practiceId: 'p-a', practice: { id: 'p-a', name: 'Cedar Hill' } },
      ])

      const result = await service.mfaChallenge('challenge.jwt', '123456', mockContext)

      expect(result).toMatchObject({
        activePracticeId: 'p-a',
        activePractice: { id: 'p-a', name: 'Cedar Hill' },
        availablePractices: [{ id: 'p-a', name: 'Cedar Hill' }],
      })
    })
  })

  describe('TASK-17: verifyOtp - Failure Paths', () => {
    it('should increment attempts counter on wrong OTP', async () => {
      const otpCode = { ...mockOtpCode, attempts: 0 }
      ;(bcryptService.compare as jest.Mock).mockResolvedValue(false)
      ;(prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.otpCode.update as jest.Mock).mockResolvedValue({
        ...otpCode,
        attempts: 1,
      })
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})

      await expect(
        service.verifyOtp('test@example.com', 'wrongcode', mockContext),
      ).rejects.toThrow(BadRequestException)

      expect(prisma.otpCode.update).toHaveBeenCalledWith({
        where: { id: otpCode.id },
        data: { attempts: 1 },
      })

      expect(prisma.authLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: 'otp_failed',
          identifier: 'test@example.com',
          success: false,
          errorCode: 'invalid_code',
          metadata: { attempts: 1 },
        }),
      })
    })

    it('should delete OTP and log locked event after 5 failed attempts', async () => {
      const otpCode = { ...mockOtpCode, attempts: 5 }
      ;(prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.otpCode.delete as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})

      await expect(
        service.verifyOtp('test@example.com', '123456', mockContext),
      ).rejects.toThrow('Too many incorrect attempts. Request a new OTP.')

      expect(prisma.otpCode.delete).toHaveBeenCalledWith({
        where: { id: otpCode.id },
      })

      expect(prisma.authLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: 'otp_locked',
          identifier: 'test@example.com',
          success: false,
          errorCode: 'max_attempts_exceeded',
          metadata: { attempts: 5 },
        }),
      })
    })

    it('should log expired event when OTP not found or expired', async () => {
      ;(prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(null)
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})

      await expect(
        service.verifyOtp('test@example.com', '123456', mockContext),
      ).rejects.toThrow('OTP not found or expired')

      expect(prisma.authLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: 'otp_expired',
          identifier: 'test@example.com',
          success: false,
          errorCode: 'otp_not_found_or_expired',
        }),
      })
    })

    it('should handle expired OTP (expiresAt in past)', async () => {
      ;(prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(null)
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})

      await expect(
        service.verifyOtp('test@example.com', '123456', mockContext),
      ).rejects.toThrow(BadRequestException)
    })

    it('should throw ForbiddenException when user account is blocked', async () => {
      const blockedUser = { ...mockUser, accountStatus: AccountStatus.BLOCKED }
      const otpCode = { ...mockOtpCode }
      ;(bcryptService.compare as jest.Mock).mockResolvedValue(true)
      ;(prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(blockedUser)
      ;(prisma.otpCode.delete as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})

      await expect(
        service.verifyOtp('test@example.com', '123456', mockContext),
      ).rejects.toThrow(ForbiddenException)
    })

    it('should throw ForbiddenException when user account is suspended', async () => {
      const suspendedUser = {
        ...mockUser,
        accountStatus: AccountStatus.SUSPENDED,
      }
      const otpCode = { ...mockOtpCode }
      ;(bcryptService.compare as jest.Mock).mockResolvedValue(true)
      ;(prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(suspendedUser)
      ;(prisma.otpCode.delete as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})

      await expect(
        service.verifyOtp('test@example.com', '123456', mockContext),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('TASK-17: verifyOtp - Edge Cases', () => {
    it('should require email', async () => {
      await expect(
        service.verifyOtp('', '123456', mockContext),
      ).rejects.toThrow(BadRequestException)

      await expect(
        service.verifyOtp(null as unknown as string, '123456', mockContext),
      ).rejects.toThrow(BadRequestException)
    })

    it('should normalize email to lowercase', async () => {
      const otpCode = { ...mockOtpCode, email: 'test@example.com' }
      ;(bcryptService.compare as jest.Mock).mockResolvedValue(true)
      ;(bcryptService.hash as jest.Mock).mockResolvedValue(
        'hashed_refresh_token',
      )
      ;(prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)
      ;(prisma.otpCode.delete as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        tokenHash: 'hash',
        expiresAt: new Date(),
      })

      await service.verifyOtp('TEST@EXAMPLE.COM', '123456', mockContext)

      expect(prisma.otpCode.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          email: 'test@example.com',
        }),
        orderBy: { createdAt: 'desc' },
      })
    })

    it('should work without context (optional parameters)', async () => {
      const otpCode = { ...mockOtpCode }
      ;(bcryptService.compare as jest.Mock).mockResolvedValue(true)
      ;(bcryptService.hash as jest.Mock).mockResolvedValue(
        'hashed_refresh_token',
      )
      ;(prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)
      ;(prisma.otpCode.delete as jest.Mock).mockResolvedValue(otpCode)
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        tokenHash: 'hash',
        expiresAt: new Date(),
      })

      await service.verifyOtp('test@example.com', '123456')

      expect(prisma.authLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deviceId: null,
          ipAddress: null,
          userAgent: null,
        }),
      })
    })
  })

  // ─── ProfileDto validation ────────────────────────────────────────────────────

  describe('ProfileDto validation', () => {
    it('should pass with an empty DTO (all fields optional)', async () => {
      const dto = Object.assign(new ProfileDto(), {})
      const errors = await validate(dto)
      expect(errors).toHaveLength(0)
    })

    it('should pass with a full valid DTO', async () => {
      const dto = Object.assign(new ProfileDto(), {
        name: 'Alice',
        dateOfBirth: '1986-04-12',
        timezone: 'America/New_York',
      })
      const errors = await validate(dto)
      expect(errors).toHaveLength(0)
    })

    it('should reject a name longer than 100 characters', async () => {
      const dto = Object.assign(new ProfileDto(), { name: 'A'.repeat(101) })
      const errors = await validate(dto)
      expect(errors.some((e) => e.property === 'name')).toBe(true)
    })

    it('should reject a dateOfBirth that is in the future', async () => {
      const futureDate = new Date(Date.now() + 86_400_000)
        .toISOString()
        .slice(0, 10)
      const dto = Object.assign(new ProfileDto(), {
        dateOfBirth: futureDate,
      })
      const errors = await validate(dto)
      expect(errors.some((e) => e.property === 'dateOfBirth')).toBe(true)
    })

    it('should reject an invalid dateOfBirth format', async () => {
      const dto = Object.assign(new ProfileDto(), {
        dateOfBirth: '12-04-1986',
      })
      const errors = await validate(dto)
      expect(errors.some((e) => e.property === 'dateOfBirth')).toBe(true)
    })

    it('should reject a timezone without a slash', async () => {
      const dto = Object.assign(new ProfileDto(), { timezone: 'UTC' })
      const errors = await validate(dto)
      expect(errors.some((e) => e.property === 'timezone')).toBe(true)
    })
  })

  // ─── submitProfile service method ─────────────────────────────────────────────

  describe('submitProfile', () => {
    it('should always set onboardingStatus = COMPLETED even with an empty DTO', async () => {
      ;(prisma.user.update as jest.Mock).mockResolvedValue({
        name: mockUser.name,
        dateOfBirth: null,
        communicationPreference: null,
        preferredLanguage: 'en',
        timezone: null,
        onboardingStatus: OnboardingStatus.COMPLETED,
      })

      const result = await service.submitProfile(mockUser.id, {})
      expect(result).toMatchObject({
        message: 'Profile saved',
        name: mockUser.name,
        onboardingStatus: OnboardingStatus.COMPLETED,
      })
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockUser.id },
          data: expect.objectContaining({
            onboardingStatus: OnboardingStatus.COMPLETED,
          }),
          select: {
            name: true,
            dateOfBirth: true,
            communicationPreference: true,
            preferredLanguage: true,
            timezone: true,
            onboardingStatus: true,
          },
        }),
      )
    })

    it('should persist all provided profile fields', async () => {
      ;(prisma.user.update as jest.Mock).mockResolvedValue({
        name: 'Alice',
        dateOfBirth: null,
        communicationPreference: null,
        preferredLanguage: 'en',
        timezone: 'Asia/Colombo',
        onboardingStatus: OnboardingStatus.COMPLETED,
      })

      await service.submitProfile(mockUser.id, {
        name: 'Alice',
        timezone: 'Asia/Colombo',
      })

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockUser.id },
          data: expect.objectContaining({
            name: 'Alice',
            timezone: 'Asia/Colombo',
            onboardingStatus: OnboardingStatus.COMPLETED,
          }),
        }),
      )
    })

    it('should store dateOfBirth as a Date when provided', async () => {
      ;(prisma.user.update as jest.Mock).mockResolvedValue({ ...mockUser })

      await service.submitProfile(mockUser.id, {
        dateOfBirth: '1986-04-12',
      })

      const call = (prisma.user.update as jest.Mock).mock.calls[0][0]
      expect(call.data.dateOfBirth).toEqual(new Date('1986-04-12'))
    })

    it('should leave dateOfBirth out of the patch when not provided', async () => {
      ;(prisma.user.update as jest.Mock).mockResolvedValue({ ...mockUser })

      await service.submitProfile(mockUser.id, { name: 'Alice' })

      const call = (prisma.user.update as jest.Mock).mock.calls[0][0]
      expect(call.data).not.toHaveProperty('dateOfBirth')
    })

    it('should not include fields that were not provided in the DTO', async () => {
      ;(prisma.user.update as jest.Mock).mockResolvedValue({ ...mockUser })

      await service.submitProfile(mockUser.id, { name: 'Bob' })

      const call = (prisma.user.update as jest.Mock).mock.calls[0][0]
      expect(call.data).not.toHaveProperty('timezone')
    })
  })

  // ─── patchProfile service method ──────────────────────────────────────────────

  describe('patchProfile', () => {
    it('should NOT change onboardingStatus when patching profile', async () => {
      ;(prisma.user.update as jest.Mock).mockResolvedValue({
        name: 'Alice Updated',
        dateOfBirth: null,
        communicationPreference: null,
        preferredLanguage: 'en',
        timezone: 'Asia/Colombo',
        onboardingStatus: OnboardingStatus.COMPLETED,
      })

      await service.patchProfile(mockUser.id, { name: 'Alice Updated' })

      const call = (prisma.user.update as jest.Mock).mock.calls[0][0]
      expect(call.data).not.toHaveProperty('onboardingStatus')
    })

    it('should return message "Profile updated"', async () => {
      ;(prisma.user.update as jest.Mock).mockResolvedValue({
        name: 'Alice',
        dateOfBirth: null,
        communicationPreference: null,
        preferredLanguage: 'en',
        timezone: null,
        onboardingStatus: OnboardingStatus.COMPLETED,
      })

      const result = await service.patchProfile(mockUser.id, { name: 'Alice' })
      expect(result.message).toBe('Profile updated')
    })
  })

  // ─── getProfile ──────────────────────────────────────────────────────────────

  describe('getProfile', () => {
    it('should return selected user fields', async () => {
      // Raw DB shape — what Prisma returns
      const dbRow = {
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        roles: mockUser.roles,
        isVerified: mockUser.isVerified,         // service renames to emailVerified
        onboardingStatus: OnboardingStatus.COMPLETED,
        accountStatus: AccountStatus.ACTIVE,     // service lowercases to 'active'
        dateOfBirth: null,
        communicationPreference: null,
        preferredLanguage: 'en',
        timezone: 'Asia/Colombo',
        createdAt: mockUser.createdAt,           // service converts to ISO string
      }
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(dbRow)

      const result = await service.getProfile(mockUser.id)

      // Match the transformed response shape (not the raw DB row).
      // PATIENT is non-org-wide + non-COORDINATOR so the dual-relation
      // probe runs and finds nothing (default mock returns [] / null),
      // leaving activePractice = null + availablePractices = [].
      expect(result).toMatchObject({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        roles: mockUser.roles,
        emailVerified: mockUser.isVerified,
        accountStatus: 'active',
        dateOfBirth: null,
        communicationPreference: null,
        preferredLanguage: 'en',
        timezone: 'Asia/Colombo',
        onboardingStatus: OnboardingStatus.COMPLETED,
        createdAt: mockUser.createdAt.toISOString(),
        activePracticeId: null,
        activePractice: null,
        availablePractices: [],
      })
    })


    it('should throw NotFoundException when user does not exist', async () => {
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(service.getProfile('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      )
    })

    // Practice-identity rehydrate-fix coverage (Manisha 2026-06-12 §1, smoke
    // 2026-06-18) — getProfile MUST return activePracticeId + activePractice
    // + availablePractices so admin's rehydrate() can restore the practice
    // chip after a browser refresh. Pre-fix, F5 dropped every PROVIDER /
    // MED_DIR / COORDINATOR into ZeroPracticeModal.
    describe('practice-identity rehydrate fields', () => {
      const dbRowFor = (roles: UserRole[]) => ({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        roles,
        isVerified: mockUser.isVerified,
        onboardingStatus: OnboardingStatus.COMPLETED,
        accountStatus: AccountStatus.ACTIVE,
        dateOfBirth: null,
        communicationPreference: null,
        preferredLanguage: 'en',
        timezone: 'America/New_York',
        createdAt: mockUser.createdAt,
      })

      it('multi-practice PROVIDER with active practice → returns both practices in availablePractices + activePractice = the active one', async () => {
        ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(
          dbRowFor([UserRole.PROVIDER]),
        )
        ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([
          { practice: { id: 'seed-cedar-hill', name: 'Cedar Hill' } },
          { practice: { id: 'seed-bridgepoint', name: 'BridgePoint' } },
        ])

        const result = await service.getProfile(mockUser.id, {
          practiceId: 'seed-cedar-hill',
        })

        expect(result.activePracticeId).toBe('seed-cedar-hill')
        expect(result.activePractice).toEqual({
          id: 'seed-cedar-hill',
          name: 'Cedar Hill',
        })
        expect(result.availablePractices).toEqual([
          { id: 'seed-cedar-hill', name: 'Cedar Hill' },
          { id: 'seed-bridgepoint', name: 'BridgePoint' },
        ])
        // COORDINATOR-only lookup must NOT run for a pure PROVIDER.
        expect(prisma.practiceCoordinator.findUnique).not.toHaveBeenCalled()
      })

      it('SUPER_ADMIN → activePracticeId/activePractice null + availablePractices [] (org-wide, never queries memberships)', async () => {
        ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(
          dbRowFor([UserRole.SUPER_ADMIN]),
        )

        const result = await service.getProfile(mockUser.id, {
          practiceId: null,
        })

        expect(result.activePracticeId).toBeNull()
        expect(result.activePractice).toBeNull()
        expect(result.availablePractices).toEqual([])
        // Org-wide bypass — neither membership relation should be touched.
        expect(prisma.practiceProvider.findMany).not.toHaveBeenCalled()
        expect(prisma.practiceCoordinator.findUnique).not.toHaveBeenCalled()
      })

      it('COORDINATOR (1:1 PracticeCoordinator) → resolves the single practice as both activePractice and the sole availablePractice', async () => {
        ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(
          dbRowFor([UserRole.COORDINATOR]),
        )
        ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([])
        ;(prisma.practiceCoordinator.findUnique as jest.Mock).mockResolvedValue({
          practice: { id: 'seed-cedar-hill', name: 'Cedar Hill' },
        })

        const result = await service.getProfile(mockUser.id, {
          practiceId: 'seed-cedar-hill',
        })

        expect(result.activePracticeId).toBe('seed-cedar-hill')
        expect(result.activePractice).toEqual({
          id: 'seed-cedar-hill',
          name: 'Cedar Hill',
        })
        expect(result.availablePractices).toEqual([
          { id: 'seed-cedar-hill', name: 'Cedar Hill' },
        ])
      })

      // PR #90 regression — a MED_DIR heads a practice via PracticeMedicalDirector,
      // not PracticeProvider. Pre-fix /auth/profile returned activePractice null +
      // availablePractices [] for every medical-director, firing the FE
      // ZeroPracticeModal whose overlay swallowed all clicks on the patient detail.
      it('MEDICAL_DIRECTOR (PracticeMedicalDirector, no provider row) → resolves the headed practice as activePractice + availablePractice', async () => {
        ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(
          dbRowFor([UserRole.MEDICAL_DIRECTOR]),
        )
        ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([])
        ;(prisma.practiceMedicalDirector.findMany as jest.Mock).mockResolvedValue([
          { practice: { id: 'seed-cedar-hill', name: 'Cedar Hill' } },
        ])

        const result = await service.getProfile(mockUser.id, {
          practiceId: 'seed-cedar-hill',
        })

        expect(result.activePracticeId).toBe('seed-cedar-hill')
        expect(result.activePractice).toEqual({
          id: 'seed-cedar-hill',
          name: 'Cedar Hill',
        })
        expect(result.availablePractices).toEqual([
          { id: 'seed-cedar-hill', name: 'Cedar Hill' },
        ])
      })

      it('JWT carries a STALE activePracticeId (practice deleted post-sign-in) → activePractice null + availablePractices unchanged (FE will route to selector / show ZeroPracticeModal correctly)', async () => {
        ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(
          dbRowFor([UserRole.PROVIDER]),
        )
        ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([
          { practice: { id: 'seed-cedar-hill', name: 'Cedar Hill' } },
        ])

        const result = await service.getProfile(mockUser.id, {
          practiceId: 'deleted-practice-id',
        })

        // No match on the stale id → activePractice null (genuine
        // "needs to re-select" signal). Available list still reflects
        // the user's real memberships so the selector can render.
        expect(result.activePracticeId).toBeNull()
        expect(result.activePractice).toBeNull()
        expect(result.availablePractices).toEqual([
          { id: 'seed-cedar-hill', name: 'Cedar Hill' },
        ])
      })

      it('no ctx passed (backwards-compat — older call sites) → activePracticeId/activePractice null', async () => {
        ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(
          dbRowFor([UserRole.PROVIDER]),
        )
        ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([
          { practice: { id: 'seed-cedar-hill', name: 'Cedar Hill' } },
        ])

        const result = await service.getProfile(mockUser.id)

        expect(result.activePracticeId).toBeNull()
        expect(result.activePractice).toBeNull()
        expect(result.availablePractices).toEqual([
          { id: 'seed-cedar-hill', name: 'Cedar Hill' },
        ])
      })
    })
  })


  // ─── Device Linking (upsertOrTrackDevice) ──────────────────────────────────────

  describe('Device Linking', () => {
    const mockDevice = {
      id: '01DEVICE123456789000',
      deviceId: 'device-uuid-123',
      platform: null,
      deviceType: null,
      deviceName: null,
      userAgent: 'test-agent',
      lastSeenAt: new Date(),
      createdAt: new Date(),
    }

    it('should include userId in AuthResponse for OTP verification', async () => {
      const context = { deviceId: 'device-uuid-123', userAgent: 'test-agent' }

      ;(prisma.otpCode.findFirst as jest.Mock).mockResolvedValue({
        id: 'otp-id',
        email: 'test@example.com',
        codeHash: 'hashed_code',
        expiresAt: new Date(Date.now() + 600000),
        attempts: 0,
      })
      ;(bcryptService.compare as jest.Mock).mockResolvedValue(true)
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)
      ;(prisma.user.create as jest.Mock).mockResolvedValue(mockUser)
      ;(prisma.otpCode.delete as jest.Mock).mockResolvedValue(undefined)

      const mockTokens = { accessToken: 'access', refreshToken: 'refresh' }
      jest
        .spyOn(service as unknown as AuthServiceWithPrivateMethods, 'issueTokenPair')
        .mockResolvedValue(mockTokens)

      const result = await service.verifyOtp('test@example.com', '123456', context)

      expect(result).toHaveProperty('userId', mockUser.id)
      expect(result).toHaveProperty('onboarding_required', false)
      expect(result).toHaveProperty('login_method', 'otp')
    })

    it('should include userId in AuthResponse for Google mobile login', async () => {
      const context = { deviceId: 'device-uuid-456', userAgent: 'mobile-agent' }

      ;(global.fetch as jest.MockedFunction<typeof fetch>) = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          sub: 'google-user-id',
          email: 'google@example.com',
          email_verified: 'true',
          name: 'Google User',
          aud: 'mock-google-client-id',
        }),
      })

      ;(prisma.account.findUnique as jest.Mock).mockResolvedValue(null)
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)
      ;(prisma.user.create as jest.Mock).mockResolvedValue(mockUser)

      const mockTokens = { accessToken: 'access', refreshToken: 'refresh' }
      jest
        .spyOn(service as unknown as AuthServiceWithPrivateMethods, 'issueTokenPair')
        .mockResolvedValue(mockTokens)

      const result = await service.googleMobileLogin('fake-token', context)

      expect(result).toHaveProperty('userId', mockUser.id)
      expect(result).toHaveProperty('login_method', 'google')
    })

    it('upsertOrTrackDevice: new device + user — creates Device and UserDevice link', async () => {
      ;(prisma.device.upsert as jest.Mock).mockResolvedValue(mockDevice)
      ;(prisma.userDevice.upsert as jest.Mock).mockResolvedValue({})

      await service.upsertOrTrackDevice({
        deviceId: 'device-uuid-123',
        userId: mockUser.id,
        userAgent: 'test-agent',
      })

      expect(prisma.device.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deviceId: 'device-uuid-123' },
          create: expect.objectContaining({ deviceId: 'device-uuid-123' }),
        }),
      )
      expect(prisma.userDevice.upsert).toHaveBeenCalledWith({
        where: { userId_deviceId: { userId: mockUser.id, deviceId: mockDevice.id } },
        create: { userId: mockUser.id, deviceId: mockDevice.id },
        update: {},
      })
    })

    it('upsertOrTrackDevice: no userId provided — only upserts Device, no UserDevice link', async () => {
      ;(prisma.device.upsert as jest.Mock).mockResolvedValue(mockDevice)

      await service.upsertOrTrackDevice({ deviceId: 'device-uuid-123' })

      expect(prisma.device.upsert).toHaveBeenCalled()
      expect(prisma.userDevice.upsert).not.toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Phase 3 — concurrent session cap (Manisha 2026-06-12 Doc 2 Q1)
  // ────────────────────────────────────────────────────────────────────────
  describe('enforceSessionLimit (concurrent sessions)', () => {
    const PATIENT_ID = 'patient-1'
    const ADMIN_ID = 'admin-1'

    // Helper — invoke the private enforceSessionLimit via issueTokenPair,
    // checking the side effects on prisma.authSession + refreshToken.
    const runEnforce = async (userId: string, roles: UserRole[]) => {
      const minimalUser = {
        id: userId,
        email: 'x@y',
        name: null,
        roles,
        onboardingStatus: OnboardingStatus.COMPLETED,
        accountStatus: AccountStatus.ACTIVE,
      }
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'new-token-id',
      })
      ;(prisma.authSession.create as jest.Mock).mockResolvedValue({})
      await (service as AuthServiceWithPrivateMethods).issueTokenPair(
        minimalUser,
        {},
      )
    }

    it('PATIENT: new login revokes the prior single session', async () => {
      const priorRefreshTokenId = 'prior-token'
      ;(prisma.authSession.findMany as jest.Mock).mockResolvedValue([
        { id: 'prior-session', refreshTokenId: priorRefreshTokenId },
      ])
      await runEnforce(PATIENT_ID, [UserRole.PATIENT])
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: priorRefreshTokenId },
        data: { revokedAt: expect.any(Date) },
      })
      expect(prisma.authSession.delete).toHaveBeenCalledWith({
        where: { id: 'prior-session' },
      })
      expect(prisma.authLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ event: 'session_evicted' }),
        }),
      )
    })

    it('ADMIN: 2 prior sessions — no eviction (under 3-cap)', async () => {
      ;(prisma.authSession.findMany as jest.Mock).mockResolvedValue([
        { id: 's1', refreshTokenId: 't1' },
        { id: 's2', refreshTokenId: 't2' },
      ])
      await runEnforce(ADMIN_ID, [UserRole.PROVIDER])
      expect(prisma.refreshToken.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
      )
      expect(prisma.authSession.delete).not.toHaveBeenCalled()
    })

    it('ADMIN: 3 prior sessions — 4th login evicts the most-idle by lastActivityAt', async () => {
      // findMany is called with orderBy lastActivityAt asc, so the first
      // element is the most-idle. The fixtures encode that order directly.
      ;(prisma.authSession.findMany as jest.Mock).mockResolvedValue([
        { id: 's-idle-most', refreshTokenId: 't-idle-most' },
        { id: 's-mid', refreshTokenId: 't-mid' },
        { id: 's-fresh', refreshTokenId: 't-fresh' },
      ])
      await runEnforce(ADMIN_ID, [UserRole.PROVIDER])
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 't-idle-most' },
        data: { revokedAt: expect.any(Date) },
      })
      expect(prisma.authSession.delete).toHaveBeenCalledWith({
        where: { id: 's-idle-most' },
      })
      // The fresher pair must NOT be touched.
      expect(prisma.refreshToken.update).not.toHaveBeenCalledWith({
        where: { id: 't-fresh' },
        data: { revokedAt: expect.any(Date) },
      })
    })

    for (const role of [
      UserRole.COORDINATOR,
      UserRole.HEALPLACE_OPS,
      UserRole.MEDICAL_DIRECTOR,
      UserRole.SUPER_ADMIN,
    ]) {
      it(`${role} treated as admin (3-session cap, not 1)`, async () => {
        ;(prisma.authSession.findMany as jest.Mock).mockResolvedValue([
          { id: 'a', refreshTokenId: 'at' },
          { id: 'b', refreshTokenId: 'bt' },
        ])
        await runEnforce('multi-role-user', [role])
        // 2 prior sessions < 3 cap → no eviction. If the role had been
        // classed as a patient (cap=1), 2 sessions would have triggered.
        expect(prisma.authSession.delete).not.toHaveBeenCalled()
      })
    }
  })

  // ────────────────────────────────────────────────────────────────────────
  // Phase 3 — AuthSession lifecycle through rotate + revoke
  // ────────────────────────────────────────────────────────────────────────
  describe('rotateRefreshToken: AuthSession heartbeat', () => {
    it('updates AuthSession.refreshTokenId on rotation (lastActivityAt bumps via @updatedAt)', async () => {
      const oldTokenId = 'old-token'
      ;(prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue({
        id: oldTokenId,
        userId: mockUser.id,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        user: mockUser,
        authSession: {
          id: 'session-1',
          userAgent: 'old-ua',
          ipAddress: '1.2.3.4',
          deviceId: 'd1',
          deviceType: 'web',
          lastActivityAt: new Date(),
        },
      })
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'new-token',
      })
      ;(prisma.refreshToken.update as jest.Mock).mockResolvedValue({})
      ;(prisma.authSession.update as jest.Mock).mockResolvedValue({})

      await service.rotateRefreshToken('raw-token', {
        userAgent: 'new-ua',
      })

      expect(prisma.authSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1' },
          data: expect.objectContaining({
            refreshTokenId: 'new-token',
            userAgent: 'new-ua',
          }),
        }),
      )
    })

    // Phase/practice-identity rehydrate-fix root cause (smoke 2026-06-18).
    // Before the fix, rotateRefreshToken minted the new access token with
    // `issueAccessToken(existing.user)` — NO second argument — so the JWT's
    // activePracticeId claim was always null after a refresh. Every browser
    // refresh silently stripped the practice context: the FE's rehydrate()
    // got a JWT with activePracticeId=null, /auth/profile via
    // @ActiveContext() resolved null, getProfile returned activePractice=null
    // → ZeroPracticeModal fired. Symptom was hidden because spec 37 (the
    // regression Playwright) had a "trivial pass" — modal-absent assertions
    // passed on /sign-in (where the FE bounced) too. Fix: thread the
    // session's activePracticeId into the new access token so it survives
    // rotation.
    it('preserves the AuthSession activePracticeId on the new access token (rehydrate fix root cause)', async () => {
      const issueAccessSpy = jest.spyOn(service, 'issueAccessToken')
      ;(prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue({
        id: 'old-token',
        userId: mockUser.id,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        user: mockUser,
        authSession: {
          id: 'session-1',
          userAgent: 'ua',
          ipAddress: '1.2.3.4',
          deviceId: 'd1',
          deviceType: 'web',
          lastActivityAt: new Date(),
          // The point of this test — rotation must propagate this claim.
          activePracticeId: 'seed-cedar-hill',
        },
      })
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'new-token',
      })
      ;(prisma.refreshToken.update as jest.Mock).mockResolvedValue({})
      ;(prisma.authSession.update as jest.Mock).mockResolvedValue({})

      await service.rotateRefreshToken('raw-token', {})

      expect(issueAccessSpy).toHaveBeenCalledWith(mockUser, 'seed-cedar-hill')
      issueAccessSpy.mockRestore()
    })

    it('legacy refresh token with no AuthSession → access token has null activePracticeId (no claim to preserve)', async () => {
      const issueAccessSpy = jest.spyOn(service, 'issueAccessToken')
      ;(prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue({
        id: 'legacy-no-session',
        userId: mockUser.id,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        user: mockUser,
        authSession: null,
      })
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'new-token',
      })
      ;(prisma.refreshToken.update as jest.Mock).mockResolvedValue({})
      ;(prisma.authSession.create as jest.Mock).mockResolvedValue({})

      await service.rotateRefreshToken('raw-token', {})

      expect(issueAccessSpy).toHaveBeenCalledWith(mockUser, null)
      issueAccessSpy.mockRestore()
    })

    it('legacy refresh token with no AuthSession — creates one on rotate (defensive)', async () => {
      ;(prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue({
        id: 'legacy-token',
        userId: mockUser.id,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        user: mockUser,
        authSession: null,
      })
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'new-token',
      })
      ;(prisma.refreshToken.update as jest.Mock).mockResolvedValue({})
      ;(prisma.authSession.create as jest.Mock).mockResolvedValue({})

      await service.rotateRefreshToken('raw-token', {})

      expect(prisma.authSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: mockUser.id,
            refreshTokenId: 'new-token',
          }),
        }),
      )
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Phase 2 — idle timeout (Manisha 2026-06-12 Doc 3 Q7)
  // ────────────────────────────────────────────────────────────────────────
  describe('rotateRefreshToken: idle timeout (Phase 2)', () => {
    const buildIdleFixture = (deviceType: 'web' | 'mobile', minutesIdle: number) => ({
      id: 'token-1',
      userId: mockUser.id,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      user: mockUser,
      authSession: {
        id: 'session-1',
        deviceType,
        userAgent: 'ua',
        ipAddress: '1.2.3.4',
        deviceId: 'd1',
        lastActivityAt: new Date(Date.now() - minutesIdle * 60_000),
      },
    })

    it('web session: allows refresh inside the 15-min idle window (14 min)', async () => {
      ;(prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue(
        buildIdleFixture('web', 14),
      )
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'new-token',
      })
      ;(prisma.refreshToken.update as jest.Mock).mockResolvedValue({})
      ;(prisma.authSession.update as jest.Mock).mockResolvedValue({})

      const result = await service.rotateRefreshToken('raw-token', {})
      expect(result.refreshToken).toBeDefined()
      expect(prisma.authSession.delete).not.toHaveBeenCalled()
    })

    it('web session: rejects refresh past the 15-min idle window (16 min)', async () => {
      ;(prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue(
        buildIdleFixture('web', 16),
      )
      ;(prisma.refreshToken.update as jest.Mock).mockResolvedValue({})
      ;(prisma.authSession.delete as jest.Mock).mockResolvedValue({})

      await expect(
        service.rotateRefreshToken('raw-token', {}),
      ).rejects.toThrow(/idle timeout/i)
      expect(prisma.authSession.delete).toHaveBeenCalledWith({
        where: { id: 'session-1' },
      })
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'token-1' },
        data: { revokedAt: expect.any(Date) },
      })
      expect(prisma.authLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ event: 'idle_timeout' }),
        }),
      )
    })

    it('mobile session: allows refresh inside the 5-min idle window (4 min)', async () => {
      ;(prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue(
        buildIdleFixture('mobile', 4),
      )
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'new-token',
      })
      ;(prisma.refreshToken.update as jest.Mock).mockResolvedValue({})
      ;(prisma.authSession.update as jest.Mock).mockResolvedValue({})

      const result = await service.rotateRefreshToken('raw-token', {})
      expect(result.refreshToken).toBeDefined()
      expect(prisma.authSession.delete).not.toHaveBeenCalled()
    })

    it('mobile session: rejects refresh past the 5-min idle window (6 min)', async () => {
      ;(prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue(
        buildIdleFixture('mobile', 6),
      )
      ;(prisma.refreshToken.update as jest.Mock).mockResolvedValue({})
      ;(prisma.authSession.delete as jest.Mock).mockResolvedValue({})

      await expect(
        service.rotateRefreshToken('raw-token', {}),
      ).rejects.toThrow(/idle timeout/i)
      expect(prisma.authSession.delete).toHaveBeenCalled()
    })

    it('legacy token with no AuthSession: skips idle gate (one grace refresh)', async () => {
      ;(prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue({
        id: 'legacy-token',
        userId: mockUser.id,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        user: mockUser,
        authSession: null,
      })
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'new-token',
      })
      ;(prisma.refreshToken.update as jest.Mock).mockResolvedValue({})
      ;(prisma.authSession.create as jest.Mock).mockResolvedValue({})

      const result = await service.rotateRefreshToken('raw-token', {})
      expect(result.refreshToken).toBeDefined()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Phase 3 — Geolocation anomaly logging (Manisha 2026-06-12 Doc 2 Q1)
  // ────────────────────────────────────────────────────────────────────────
  describe('rotateRefreshToken: geolocation anomaly audit (audit-only, no block)', () => {
    let geo: GeolocationService

    beforeEach(() => {
      geo = service['geolocation'] as GeolocationService
    })

    const buildFixture = (storedGeohash: string | null, storedCountry: string | null) => ({
      id: 'token-1',
      userId: mockUser.id,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      user: mockUser,
      authSession: {
        id: 'session-1',
        deviceType: 'web',
        userAgent: 'ua',
        ipAddress: '1.2.3.4',
        deviceId: 'd1',
        lastActivityAt: new Date(),
        geohash: storedGeohash,
        ipCountry: storedCountry,
      },
    })

    it('same geohash on rotation → no anomaly logged, rotation succeeds', async () => {
      ;(geo.computeGeohash as jest.Mock).mockReturnValue('gh-same')
      ;(geo.lookupCountry as jest.Mock).mockReturnValue('US')
      ;(prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue(
        buildFixture('gh-same', 'US'),
      )
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({ id: 'new-token' })
      ;(prisma.refreshToken.update as jest.Mock).mockResolvedValue({})
      ;(prisma.authSession.update as jest.Mock).mockResolvedValue({})

      const result = await service.rotateRefreshToken('raw-token', {
        ipAddress: '1.2.3.4',
      })
      expect(result.refreshToken).toBeDefined()
      expect(prisma.authLog.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ event: 'geolocation_anomaly' }),
        }),
      )
    })

    it('different geohash on rotation → geolocation_anomaly logged, rotation succeeds', async () => {
      ;(geo.computeGeohash as jest.Mock).mockReturnValue('gh-NEW')
      ;(geo.lookupCountry as jest.Mock).mockReturnValue('GB')
      ;(prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue(
        buildFixture('gh-OLD', 'US'),
      )
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({ id: 'new-token' })
      ;(prisma.refreshToken.update as jest.Mock).mockResolvedValue({})
      ;(prisma.authSession.update as jest.Mock).mockResolvedValue({})

      const result = await service.rotateRefreshToken('raw-token', {
        ipAddress: '5.6.7.8',
      })
      // Rotation still proceeds — anomaly is audit-only.
      expect(result.refreshToken).toBeDefined()
      // Anomaly event logged with both geohashes in metadata.
      expect(prisma.authLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'geolocation_anomaly',
            userId: mockUser.id,
            metadata: expect.objectContaining({
              storedGeohash: 'gh-OLD',
              currentGeohash: 'gh-NEW',
              storedCountry: 'US',
              currentCountry: 'GB',
            }),
          }),
        }),
      )
    })

    it('first rotation (stored geohash null) → no anomaly logged, geohash backfills', async () => {
      ;(geo.computeGeohash as jest.Mock).mockReturnValue('gh-FIRST')
      ;(geo.lookupCountry as jest.Mock).mockReturnValue('UNKNOWN')
      ;(prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue(
        buildFixture(null, null),
      )
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({ id: 'new-token' })
      ;(prisma.refreshToken.update as jest.Mock).mockResolvedValue({})
      ;(prisma.authSession.update as jest.Mock).mockResolvedValue({})

      await service.rotateRefreshToken('raw-token', { ipAddress: '1.2.3.4' })

      expect(prisma.authLog.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ event: 'geolocation_anomaly' }),
        }),
      )
      // The new geohash is written to the session for the next rotation to compare.
      expect(prisma.authSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ geohash: 'gh-FIRST' }),
        }),
      )
    })

    it('IP missing on rotation (currentGeohash null) → no anomaly logged', async () => {
      ;(geo.computeGeohash as jest.Mock).mockReturnValue(null)
      ;(geo.lookupCountry as jest.Mock).mockReturnValue('UNKNOWN')
      ;(prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue(
        buildFixture('gh-OLD', 'US'),
      )
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({ id: 'new-token' })
      ;(prisma.refreshToken.update as jest.Mock).mockResolvedValue({})
      ;(prisma.authSession.update as jest.Mock).mockResolvedValue({})

      await service.rotateRefreshToken('raw-token', {})

      expect(prisma.authLog.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ event: 'geolocation_anomaly' }),
        }),
      )
    })
  })

  describe('revokeRefreshToken: deletes paired AuthSession', () => {
    it('logout deletes the AuthSession row alongside revoking the token', async () => {
      ;(prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue({
        id: 'token-1',
        userId: mockUser.id,
        user: mockUser,
        authSession: { id: 'session-1' },
      })
      ;(prisma.refreshToken.update as jest.Mock).mockResolvedValue({})
      ;(prisma.authSession.delete as jest.Mock).mockResolvedValue({})

      await service.revokeRefreshToken('raw-token', {})

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'token-1' },
        data: { revokedAt: expect.any(Date) },
      })
      expect(prisma.authSession.delete).toHaveBeenCalledWith({
        where: { id: 'session-1' },
      })
    })

    it('logout with no paired AuthSession (legacy) — still revokes the token', async () => {
      ;(prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue({
        id: 'token-1',
        userId: mockUser.id,
        user: mockUser,
        authSession: null,
      })
      ;(prisma.refreshToken.update as jest.Mock).mockResolvedValue({})

      await service.revokeRefreshToken('raw-token', {})

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'token-1' },
        data: { revokedAt: expect.any(Date) },
      })
      expect(prisma.authSession.delete).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Phase/practice-identity (Manisha 2026-06-12 Access Control §1)
  // ==========================================================================
  describe('resolvePracticeContext', () => {
    it('SUPER_ADMIN → kind:"none" (org-wide, bypasses selector)', async () => {
      const result = await service.resolvePracticeContext('user-x', [
        UserRole.SUPER_ADMIN,
      ])
      expect(result).toEqual({ kind: 'none' })
      expect(prisma.practiceProvider.findMany).not.toHaveBeenCalled()
    })

    it('HEALPLACE_OPS → kind:"none" (org-wide, bypasses selector)', async () => {
      const result = await service.resolvePracticeContext('user-x', [
        UserRole.HEALPLACE_OPS,
      ])
      expect(result).toEqual({ kind: 'none' })
    })

    it('PATIENT → kind:"none" (not a multi-practice role)', async () => {
      const result = await service.resolvePracticeContext('user-x', [
        UserRole.PATIENT,
      ])
      expect(result).toEqual({ kind: 'none' })
    })

    // Regression — adding COORDINATOR to MULTI_PRACTICE_ROLES caused every
    // COORDINATOR sign-in to be blocked with "No practice membership" because
    // resolvePracticeContext looked them up in PracticeProvider (always
    // empty for COORDINATOR) instead of the 1:1 PracticeCoordinator relation.
    // Broke Playwright specs 35.4 / 35.5 / 37.1 / 37.3 / 37.4 / 38.1.
    it('COORDINATOR with a PracticeCoordinator row → kind:"auto" with that practiceId (audit attribution lives on the 1:1 relation)', async () => {
      ;(prisma.practiceCoordinator.findUnique as jest.Mock).mockResolvedValue({
        practiceId: 'p-cedar',
      })
      const result = await service.resolvePracticeContext('coord-1', [
        UserRole.COORDINATOR,
      ])
      expect(result).toEqual({ kind: 'auto', activePracticeId: 'p-cedar' })
      expect(prisma.practiceCoordinator.findUnique).toHaveBeenCalledWith({
        where: { userId: 'coord-1' },
        select: { practiceId: true },
      })
      // PracticeProvider must NOT be queried for COORDINATOR — they never
      // belong there and the old code falsely blocked them on its empty
      // result set.
      expect(prisma.practiceProvider.findMany).not.toHaveBeenCalled()
    })

    it('COORDINATOR without a PracticeCoordinator row → kind:"none" (front-desk role; missing-practice is not a clinical blocker like §1 requires for PROVIDER/MED_DIR)', async () => {
      ;(prisma.practiceCoordinator.findUnique as jest.Mock).mockResolvedValue(null)
      const result = await service.resolvePracticeContext('coord-orphan', [
        UserRole.COORDINATOR,
      ])
      expect(result).toEqual({ kind: 'none' })
    })

    it('PROVIDER with single membership → kind:"auto" with that practiceId', async () => {
      ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([
        { practiceId: 'p-a', practice: { id: 'p-a', name: 'Cedar Hill' } },
      ])
      const result = await service.resolvePracticeContext('user-x', [
        UserRole.PROVIDER,
      ])
      expect(result).toEqual({ kind: 'auto', activePracticeId: 'p-a' })
    })

    it('PROVIDER with 2+ memberships → kind:"select" with the practices', async () => {
      ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([
        { practiceId: 'p-a', practice: { id: 'p-a', name: 'Cedar Hill' } },
        { practiceId: 'p-b', practice: { id: 'p-b', name: 'BridgePoint' } },
      ])
      const result = await service.resolvePracticeContext('user-x', [
        UserRole.PROVIDER,
      ])
      expect(result).toEqual({
        kind: 'select',
        practices: [
          { id: 'p-a', name: 'Cedar Hill' },
          { id: 'p-b', name: 'BridgePoint' },
        ],
      })
    })

    it('PROVIDER with zero memberships → kind:"blocked"', async () => {
      ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([])
      const result = await service.resolvePracticeContext('user-x', [
        UserRole.PROVIDER,
      ])
      expect(result).toEqual({ kind: 'blocked' })
    })

    it('MEDICAL_DIRECTOR with 2+ memberships → same selector branch as PROVIDER', async () => {
      ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([
        { practiceId: 'p-a', practice: { id: 'p-a', name: 'A' } },
        { practiceId: 'p-b', practice: { id: 'p-b', name: 'B' } },
      ])
      const result = await service.resolvePracticeContext('user-x', [
        UserRole.MEDICAL_DIRECTOR,
      ])
      expect(result.kind).toBe('select')
    })

    // PR #90 regression (CI spec 10 medicalDirector sign-in 403'd) — an MD's
    // membership lives on PracticeMedicalDirector, NOT PracticeProvider. The
    // pre-fix lookup only probed PracticeProvider → 0 rows → kind:"blocked" →
    // verifyOtp threw "No practice membership" and blocked every seeded MD.
    it('MEDICAL_DIRECTOR who heads ONE practice (PracticeMedicalDirector only, no provider row) → kind:"auto"', async () => {
      ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.practiceMedicalDirector.findMany as jest.Mock).mockResolvedValue([
        { practice: { id: 'p-cedar', name: 'Cedar Hill' } },
      ])
      const result = await service.resolvePracticeContext('md-1', [
        UserRole.MEDICAL_DIRECTOR,
      ])
      expect(result).toEqual({ kind: 'auto', activePracticeId: 'p-cedar' })
    })

    it('MEDICAL_DIRECTOR heading 2 practices via PracticeMedicalDirector → kind:"select"', async () => {
      ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.practiceMedicalDirector.findMany as jest.Mock).mockResolvedValue([
        { practice: { id: 'p-a', name: 'A' } },
        { practice: { id: 'p-b', name: 'B' } },
      ])
      const result = await service.resolvePracticeContext('md-2', [
        UserRole.MEDICAL_DIRECTOR,
      ])
      expect(result).toEqual({
        kind: 'select',
        practices: [
          { id: 'p-a', name: 'A' },
          { id: 'p-b', name: 'B' },
        ],
      })
    })

    it('MEDICAL_DIRECTOR who is ALSO a provider-member of the same practice → deduped to kind:"auto" (one practice)', async () => {
      ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([
        { practice: { id: 'p-cedar', name: 'Cedar Hill' } },
      ])
      ;(prisma.practiceMedicalDirector.findMany as jest.Mock).mockResolvedValue([
        { practice: { id: 'p-cedar', name: 'Cedar Hill' } },
      ])
      const result = await service.resolvePracticeContext('md-3', [
        UserRole.MEDICAL_DIRECTOR,
      ])
      expect(result).toEqual({ kind: 'auto', activePracticeId: 'p-cedar' })
    })

    it('MEDICAL_DIRECTOR with zero rows in BOTH relations → kind:"blocked" (Manisha §1 refusal preserved)', async () => {
      ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.practiceMedicalDirector.findMany as jest.Mock).mockResolvedValue([])
      const result = await service.resolvePracticeContext('md-orphan', [
        UserRole.MEDICAL_DIRECTOR,
      ])
      expect(result).toEqual({ kind: 'blocked' })
    })

    it('PROVIDER (not MED_DIR) never queries PracticeMedicalDirector', async () => {
      ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([
        { practice: { id: 'p-a', name: 'A' } },
      ])
      await service.resolvePracticeContext('prov-1', [UserRole.PROVIDER])
      expect(prisma.practiceMedicalDirector.findMany).not.toHaveBeenCalled()
    })

    it('SUPER_ADMIN with 2+ memberships → still "none" (org-wide trumps)', async () => {
      ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([
        { practiceId: 'p-a', practice: { id: 'p-a', name: 'A' } },
        { practiceId: 'p-b', practice: { id: 'p-b', name: 'B' } },
      ])
      const result = await service.resolvePracticeContext('user-x', [
        UserRole.SUPER_ADMIN,
        UserRole.PROVIDER,
      ])
      expect(result.kind).toBe('none')
    })
  })

  describe('switchPractice', () => {
    const provider = {
      id: 'user-prov',
      email: 'p@example.com',
      name: 'Dr. P',
      roles: [UserRole.PROVIDER],
      onboardingStatus: OnboardingStatus.COMPLETED,
      accountStatus: AccountStatus.ACTIVE,
    }

    it('throws ForbiddenException when target practice is not in memberships', async () => {
      ;(prisma.practiceProvider.findUnique as jest.Mock).mockResolvedValue(null)
      await expect(
        service.switchPractice('user-prov', 'token-1', 'p-c'),
      ).rejects.toThrow(ForbiddenException)
      // Defensive — should NOT touch AuthSession or AuthLog when membership check fails.
      expect(prisma.authSession.update).not.toHaveBeenCalled()
    })

    it('updates AuthSession.activePracticeId + writes practice_switched AuthLog with practiceContext', async () => {
      ;(prisma.practiceProvider.findUnique as jest.Mock).mockResolvedValue({
        id: 'pp-1',
      })
      ;(prisma.authSession.findUnique as jest.Mock).mockResolvedValue({
        activePracticeId: 'p-a',
      })
      ;(prisma.authSession.update as jest.Mock).mockResolvedValue({
        user: provider,
      })
      const result = await service.switchPractice('user-prov', 'token-1', 'p-b')
      expect(result.activePracticeId).toBe('p-b')
      // Fresh access token is minted carrying the new context.
      expect(typeof result.accessToken).toBe('string')
      expect(prisma.authSession.update).toHaveBeenCalledWith({
        where: { refreshTokenId: 'token-1' },
        data: { activePracticeId: 'p-b' },
        select: expect.any(Object),
      })
      const authLogCall = (prisma.authLog.create as jest.Mock).mock.calls.find(
        (c: unknown[]) =>
          (c[0] as { data: { event: string } }).data.event === 'practice_switched',
      )
      expect(authLogCall).toBeTruthy()
      const data = (authLogCall![0] as { data: { practiceContext: string } }).data
      expect(data.practiceContext).toBe('p-b')
    })

    it('PR #90 Bug A — response carries activePractice {id,name} + availablePractices', async () => {
      ;(prisma.practiceProvider.findUnique as jest.Mock).mockResolvedValue({
        id: 'pp-1',
      })
      ;(prisma.authSession.findUnique as jest.Mock).mockResolvedValue({
        activePracticeId: 'p-a',
      })
      ;(prisma.authSession.update as jest.Mock).mockResolvedValue({
        user: provider,
      })
      ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([
        { practice: { id: 'p-a', name: 'Cedar Hill' } },
        { practice: { id: 'p-b', name: 'BridgePoint' } },
      ])
      const result = await service.switchPractice('user-prov', 'token-1', 'p-b')
      expect(result.activePractice).toEqual({ id: 'p-b', name: 'BridgePoint' })
      expect(result.availablePractices).toEqual([
        { id: 'p-a', name: 'Cedar Hill' },
        { id: 'p-b', name: 'BridgePoint' },
      ])
    })

    it('PR #90 — MED_DIR who heads the target practice (PracticeMedicalDirector, no provider row) can switch', async () => {
      ;(prisma.practiceProvider.findUnique as jest.Mock).mockResolvedValue(null)
      ;(prisma.practiceMedicalDirector.findUnique as jest.Mock).mockResolvedValue({
        id: 'pmd-1',
      })
      ;(prisma.authSession.findUnique as jest.Mock).mockResolvedValue({
        activePracticeId: 'p-a',
      })
      ;(prisma.authSession.update as jest.Mock).mockResolvedValue({
        user: provider,
      })
      const result = await service.switchPractice('md-1', 'token-1', 'p-b')
      expect(result.activePracticeId).toBe('p-b')
      expect(prisma.authSession.update).toHaveBeenCalled()
    })
  })

  describe('selectPractice', () => {
    const provider = {
      id: 'user-prov',
      email: 'p@example.com',
      name: 'Dr. P',
      roles: [UserRole.PROVIDER],
      isVerified: true,
      onboardingStatus: OnboardingStatus.COMPLETED,
      accountStatus: AccountStatus.ACTIVE,
      dateOfBirth: null,
      communicationPreference: null,
      preferredLanguage: 'en',
      timezone: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    function setupHappyPath() {
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(provider)
      ;(prisma.practiceProvider.findUnique as jest.Mock).mockResolvedValue({
        id: 'pp-1',
      })
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-fresh',
      })
      ;(prisma.authSession.create as jest.Mock).mockResolvedValue({
        id: 'sess-fresh',
      })
    }

    it('rejects with 401 when the challenge JWT fails to verify', async () => {
      ;(jwtService.verifyAsync as jest.Mock).mockRejectedValueOnce(
        new Error('jwt expired'),
      )
      await expect(
        service.selectPractice('bad.jwt', 'p-a'),
      ).rejects.toThrow(UnauthorizedException)
      expect(prisma.user.findUnique).not.toHaveBeenCalled()
    })

    it('rejects when the challenge payload has the wrong kind (replay defense)', async () => {
      ;(jwtService.verifyAsync as jest.Mock).mockResolvedValueOnce({
        sub: 'user-prov',
        kind: 'access', // not 'practice_select'
      })
      await expect(
        service.selectPractice('access.jwt', 'p-a'),
      ).rejects.toThrow(UnauthorizedException)
    })

    it('rejects with 403 when the chosen practice is not in user memberships', async () => {
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(provider)
      ;(prisma.practiceProvider.findUnique as jest.Mock).mockResolvedValue(null)
      await expect(
        service.selectPractice('valid.jwt', 'p-other'),
      ).rejects.toThrow(ForbiddenException)
      // No tokens issued for a foreign practice attempt.
      expect(prisma.refreshToken.create).not.toHaveBeenCalled()
    })

    it('issues token pair + writes practice_selected AuthLog with practiceContext on happy path', async () => {
      setupHappyPath()
      const result = await service.selectPractice('valid.jwt', 'p-a')
      expect(result.accessToken).toBe('mock.jwt.token')
      expect(typeof result.refreshToken).toBe('string')
      expect(result.activePracticeId).toBe('p-a')
      // AuthSession.create must persist activePracticeId so subsequent
      // requests on this device carry the JWT claim correctly.
      expect(prisma.authSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ activePracticeId: 'p-a' }),
        }),
      )
      const authLogCall = (prisma.authLog.create as jest.Mock).mock.calls.find(
        (c: unknown[]) =>
          (c[0] as { data: { event: string } }).data.event === 'practice_selected',
      )
      expect(authLogCall).toBeTruthy()
      const data = (authLogCall![0] as { data: { practiceContext: string } }).data
      expect(data.practiceContext).toBe('p-a')
    })

    it('PR #90 Bug A — response carries activePractice {id,name} + availablePractices', async () => {
      setupHappyPath()
      ;(prisma.practiceProvider.findMany as jest.Mock).mockResolvedValue([
        { practice: { id: 'p-a', name: 'Cedar Hill' } },
        { practice: { id: 'p-b', name: 'BridgePoint' } },
      ])
      const result = await service.selectPractice('valid.jwt', 'p-a')
      expect(result.activePractice).toEqual({ id: 'p-a', name: 'Cedar Hill' })
      expect(result.availablePractices).toEqual([
        { id: 'p-a', name: 'Cedar Hill' },
        { id: 'p-b', name: 'BridgePoint' },
      ])
    })

    it('PR #90 Bug A — SUPER_ADMIN-style org-wide select yields null activePractice + [] (edge case)', async () => {
      // A SUPER_ADMIN never hits the selector, but assert the bundle stays
      // null/[] for an org-wide role so the response shape is well-defined.
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...provider,
        roles: [UserRole.SUPER_ADMIN],
      })
      ;(prisma.practiceProvider.findUnique as jest.Mock).mockResolvedValue({
        id: 'pp-1',
      })
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-fresh',
      })
      ;(prisma.authSession.create as jest.Mock).mockResolvedValue({
        id: 'sess-fresh',
      })
      const result = await service.selectPractice('valid.jwt', 'p-a')
      expect(result.activePractice).toBeNull()
      expect(result.availablePractices).toEqual([])
    })

    it('PR #90 — MED_DIR who heads the chosen practice (PracticeMedicalDirector, no provider row) can select', async () => {
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...provider,
        roles: [UserRole.MEDICAL_DIRECTOR],
      })
      ;(prisma.practiceProvider.findUnique as jest.Mock).mockResolvedValue(null)
      ;(prisma.practiceMedicalDirector.findUnique as jest.Mock).mockResolvedValue({
        id: 'pmd-1',
      })
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-fresh',
      })
      ;(prisma.authSession.create as jest.Mock).mockResolvedValue({
        id: 'sess-fresh',
      })
      const result = await service.selectPractice('valid.jwt', 'p-a')
      expect(result.activePracticeId).toBe('p-a')
    })
  })
})
