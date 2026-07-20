import { jest } from '@jest/globals'
import { BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ThrottlerModule } from '@nestjs/throttler'
import { Test, TestingModule } from '@nestjs/testing'
import type { Request, Response } from 'express'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { AccountLifecycleService } from '../users/account-lifecycle.service.js'

describe('AuthController - OTP device ID enforcement', () => {
  let controller: AuthController
  let authService: jest.Mocked<AuthService>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      // V-03 (2026-07-17) — AuthController is now @UseGuards(AuthThrottlerGuard),
      // so building it requires the throttler's DI (THROTTLER:MODULE_OPTIONS +
      // ThrottlerStorage). Mirror app.module.ts's real config rather than
      // stubbing the guard out: these tests then exercise the controller as it
      // is actually mounted. The limits are irrelevant here — each test makes
      // one request, far under 20/60s.
      imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 20 }])],
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            verifyOtp: jest.fn(),
            upsertOrTrackDevice: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: AccountLifecycleService,
          useValue: {
            deactivate: jest.fn(),
            requestSelfClose: jest.fn(),
            verifySelfCloseToken: jest.fn(),
            permanentClose: jest.fn(),
          },
        },
      ],
    }).compile()

    controller = module.get<AuthController>(AuthController)
    authService = module.get(AuthService) as jest.Mocked<AuthService>
  })

  describe('verifyOtp', () => {
    it('should throw BadRequestException when deviceId is missing in both header and body', async () => {
      const req = {
        headers: {
          // no x-device-id
          'user-agent': 'jest-test',
        },
      } as unknown as Request

      const res = {
        cookie: jest.fn(),
      } as unknown as Response

      await expect(
        controller.verifyOtp({ email: 'test@example.com', otp: '123456' }, req, res),
      ).rejects.toThrow(
        new BadRequestException(
          'Device ID is required. Send via header x-device-id or body deviceId.',
        ),
      )
    })

    it('should accept deviceId from body when header is missing', async () => {
      const req = {
        headers: {
          // no x-device-id
          'user-agent': 'jest-test',
        },
      } as unknown as Request

      const res = {
        cookie: jest.fn(),
      } as unknown as Response

      authService.verifyOtp.mockResolvedValue({
        accessToken: 'access',
        refreshToken: 'refresh',
        userId: 'user-1',
        onboarding_required: false,
        roles: [],
        login_method: 'otp',
        name: null,
        email: null,
      })

      await controller.verifyOtp(
        {
          email: 'test@example.com',
          otp: '123456',
          deviceId: 'body-device-123',
        },
        req,
        res,
      )

      expect(authService.verifyOtp).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        expect.objectContaining({ deviceId: 'body-device-123' }),
      )
    })
  })
})

