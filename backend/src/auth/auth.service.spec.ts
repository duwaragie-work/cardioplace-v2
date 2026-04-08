// @ts-nocheck
import { jest } from '@jest/globals'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test, TestingModule } from '@nestjs/testing'
import { validate } from 'class-validator'
import {
  AccountStatus,
  CommunicationPreference,
  OnboardingStatus,
  RiskTier,
  UserRole,
} from '../generated/prisma/enums.js'
import { EmailService } from '../email/email.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { AuthService } from './auth.service.js'
import { BcryptService } from './bcrypt.service.js'
import { ProfileDto } from './dto/profile.dto.js'

// Type for spying on private methods in tests
type AuthServiceWithPrivateMethods = AuthService & {
  issueTokenPair: (...args: unknown[]) => Promise<unknown>
}

describe('AuthService', () => {
  let service: AuthService
  let prisma: PrismaService
  let bcryptService: BcryptService

  // Mock data
  const mockUser = {
    id: '01JCEXAMPLE123456789',
    email: 'test@example.com',
    name: 'Test User',
    roles: [UserRole.REGISTERED_USER],
    isVerified: true,
    onboardingStatus: OnboardingStatus.COMPLETED,
    accountStatus: AccountStatus.ACTIVE,
    dateOfBirth: null,
    communicationPreference: null,
    preferredLanguage: 'en',
    riskTier: RiskTier.STANDARD,
    primaryCondition: null,
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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            authLog: {
              create: jest.fn(),
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
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest
              .fn<() => Promise<string>>()
              .mockResolvedValue('mock.jwt.token'),
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
                RESEND_API_KEY: 'test-resend-key',
                EMAIL_FROM: 'Cardioplace <onboarding@resend.dev>',
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
      ],
    }).compile()

    service = module.get<AuthService>(AuthService)
    prisma = module.get<PrismaService>(PrismaService)
    bcryptService = module.get<BcryptService>(BcryptService)
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

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to log auth event:',
        expect.any(Error),
      )

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
          roles: [UserRole.REGISTERED_USER],
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
        riskTier: 'ELEVATED',
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

    it('should reject an invalid riskTier value', async () => {
      const dto = Object.assign(new ProfileDto(), {
        riskTier: 'INVALID_TIER',
      })
      const errors = await validate(dto)
      expect(errors.some((e) => e.property === 'riskTier')).toBe(true)
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
        riskTier: RiskTier.STANDARD,
        primaryCondition: null,
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
            riskTier: true,
            primaryCondition: true,
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
        riskTier: RiskTier.ELEVATED,
        primaryCondition: 'hypertension',
        timezone: 'Asia/Colombo',
        onboardingStatus: OnboardingStatus.COMPLETED,
      })

      await service.submitProfile(mockUser.id, {
        name: 'Alice',
        riskTier: 'ELEVATED',
        primaryCondition: 'hypertension',
        timezone: 'Asia/Colombo',
      })

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockUser.id },
          data: expect.objectContaining({
            name: 'Alice',
            riskTier: 'ELEVATED',
            primaryCondition: 'hypertension',
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
      expect(call.data).not.toHaveProperty('riskTier')
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
        riskTier: RiskTier.STANDARD,
        primaryCondition: null,
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
        riskTier: RiskTier.STANDARD,
        primaryCondition: null,
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
        riskTier: RiskTier.STANDARD,
        primaryCondition: null,
        timezone: 'Asia/Colombo',
        createdAt: mockUser.createdAt,           // service converts to ISO string
      }
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(dbRow)

      const result = await service.getProfile(mockUser.id)

      // Match the transformed response shape (not the raw DB row)
      expect(result).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        roles: mockUser.roles,
        emailVerified: mockUser.isVerified,
        accountStatus: 'active',
        dateOfBirth: null,
        diagnosisDate: null,
        communicationPreference: null,
        preferredLanguage: 'en',
        riskTier: RiskTier.STANDARD,
        primaryCondition: null,
        timezone: 'Asia/Colombo',
        onboardingStatus: OnboardingStatus.COMPLETED,
        createdAt: mockUser.createdAt.toISOString(),
      })
    })


    it('should throw NotFoundException when user does not exist', async () => {
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(service.getProfile('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      )
    })
  })


  // ─── Guest Login ────────────────────────────────────────────────────────

  describe('guestLogin', () => {
    // Shared mock data
    const mockDevice = {
      id: '01DEVICE123456789000',
      deviceId: 'device-guest-1',
      platform: null,
      deviceType: null,
      deviceName: null,
      userAgent: null,
      lastSeenAt: new Date(),
      createdAt: new Date(),
    }

    const guestUser = {
      id: '01JCGUEST123456789',
      email: null,
      name: null,
      roles: [UserRole.GUEST],
      isVerified: false,
      onboardingStatus: OnboardingStatus.NOT_COMPLETED,
      accountStatus: AccountStatus.ACTIVE,
      dateOfBirth: null,
      communicationPreference: null,
      preferredLanguage: 'en',
      riskTier: RiskTier.STANDARD,
      primaryCondition: null,
      timezone: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    beforeEach(() => {
      // Device.upsert always returns the mock device
      ;(prisma.device.upsert as jest.Mock).mockResolvedValue(mockDevice)
      ;(prisma.authLog.create as jest.Mock).mockResolvedValue({})
      ;(prisma.refreshToken.create as jest.Mock).mockResolvedValue({})
    })

    it('should throw BadRequestException when deviceId is missing', async () => {
      await expect(
        service.guestLogin({ deviceId: '' }),
      ).rejects.toThrow('Device ID is required')
      await expect(
        service.guestLogin({ deviceId: '   ' }),
      ).rejects.toThrow('Device ID is required')
    })

    it('Case: new device — creates new GUEST user and UserDevice link', async () => {
      // No existing GUEST link for this device
      ;(prisma.userDevice.findFirst as jest.Mock).mockResolvedValue(null)
      ;(prisma.user.create as jest.Mock).mockResolvedValue(guestUser)
      ;(prisma.userDevice.create as jest.Mock).mockResolvedValue({})

      const result = await service.guestLogin({
        deviceId: 'device-guest-1',
        userAgent: 'Mozilla/5.0',
      })

      // Device upserted
      expect(prisma.device.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deviceId: 'device-guest-1' } }),
      )
      // Looked for existing GUEST link
      expect(prisma.userDevice.findFirst).toHaveBeenCalledWith({
        where: { deviceId: mockDevice.id, user: { roles: { has: UserRole.GUEST } } },
        include: { user: true },
      })
      // Created new GUEST user
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { roles: [UserRole.GUEST] },
      })
      // Created UserDevice join row
      expect(prisma.userDevice.create).toHaveBeenCalledWith({
        data: { userId: guestUser.id, deviceId: mockDevice.id },
      })
      expect(result).toMatchObject({
        userId: guestUser.id,
        roles: [UserRole.GUEST],
        login_method: 'guest',
        onboarding_required: true,
      })
      expect(result).toHaveProperty('accessToken')
      expect(result).toHaveProperty('refreshToken')
    })

    it('Case: returning guest — resumes same session (same GUEST user returned)', async () => {
      // Existing GUEST user already linked to this device
      ;(prisma.userDevice.findFirst as jest.Mock).mockResolvedValue({
        id: '01LINK000000000001',
        userId: guestUser.id,
        deviceId: mockDevice.id,
        user: guestUser,
      })

      const result = await service.guestLogin({ deviceId: 'device-guest-1' })

      // Should NOT create a new user
      expect(prisma.user.create).not.toHaveBeenCalled()
      expect(prisma.userDevice.create).not.toHaveBeenCalled()

      expect(result).toMatchObject({
        userId: guestUser.id,
        login_method: 'guest',
      })
    })

    it('Case: device has only registered user — creates NEW GUEST user', async () => {
      // No GUEST-role UserDevice found (device only linked to registered user)
      ;(prisma.userDevice.findFirst as jest.Mock).mockResolvedValue(null)
      const newGuestUser = { ...guestUser, id: '01JCGUEST_NEW_000001' }
      ;(prisma.user.create as jest.Mock).mockResolvedValue(newGuestUser)
      ;(prisma.userDevice.create as jest.Mock).mockResolvedValue({})

      const result = await service.guestLogin({ deviceId: 'device-guest-1' })

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { roles: [UserRole.GUEST] },
      })
      expect(prisma.userDevice.create).toHaveBeenCalledWith({
        data: { userId: newGuestUser.id, deviceId: mockDevice.id },
      })
      // Must NOT return the registered user
      expect(result.userId).toBe(newGuestUser.id)
      expect(result.login_method).toBe('guest')
    })

    it('should throw ForbiddenException when existing guest account is blocked', async () => {
      const blockedGuest = { ...guestUser, accountStatus: AccountStatus.BLOCKED }
      ;(prisma.userDevice.findFirst as jest.Mock).mockResolvedValue({
        id: '01LINK000000000002',
        userId: blockedGuest.id,
        deviceId: mockDevice.id,
        user: blockedGuest,
      })

      await expect(
        service.guestLogin({ deviceId: 'device-guest-1' }),
      ).rejects.toThrow(ForbiddenException)
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
})
