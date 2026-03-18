import { jest } from '@jest/globals'
import { BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'
import type { Request, Response } from 'express'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'

describe('AuthController - device ID enforcement', () => {
  let controller: AuthController
  let authService: jest.Mocked<AuthService>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            googleMobileLogin: jest.fn(),
            appleLogin: jest.fn(),
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
      ],
    }).compile()

    controller = module.get<AuthController>(AuthController)
    authService = module.get(AuthService) as jest.Mocked<AuthService>
  })

  describe('googleMobile', () => {
    it('should throw BadRequestException when deviceId header is missing or blank', async () => {
      const req = {
        headers: {
          // no x-device-id
          'user-agent': 'jest-test',
        },
      } as unknown as Request

      await expect(
        controller.googleMobile({ idToken: 'token' }, req),
      ).rejects.toThrow(
        new BadRequestException(
          'Device ID is required. Send via header x-device-id.',
        ),
      )

      const reqBlank = {
        headers: {
          'x-device-id': '   ',
          'user-agent': 'jest-test',
        },
      } as unknown as Request

      await expect(
        controller.googleMobile({ idToken: 'token' }, reqBlank),
      ).rejects.toThrow(
        new BadRequestException(
          'Device ID is required. Send via header x-device-id.',
        ),
      )
    })
  })

  describe('apple', () => {
    it('should throw BadRequestException when deviceId header is missing or blank', async () => {
      const req = {
        headers: {
          // no x-device-id
          'user-agent': 'jest-test',
        },
      } as unknown as Request

      await expect(
        controller.apple({ identityToken: 'token' }, req),
      ).rejects.toThrow(
        new BadRequestException(
          'Device ID is required. Send via header x-device-id.',
        ),
      )

      const reqBlank = {
        headers: {
          'x-device-id': '   ',
          'user-agent': 'jest-test',
        },
      } as unknown as Request

      await expect(
        controller.apple({ identityToken: 'token' }, reqBlank),
      ).rejects.toThrow(
        new BadRequestException(
          'Device ID is required. Send via header x-device-id.',
        ),
      )
    })
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

