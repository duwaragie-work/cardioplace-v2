import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import { AuthService, TokenPair } from './auth.service.js'
import { Public } from './decorators/public.decorator.js'
import { AppleLoginDto } from './dto/apple-login.dto.js'
import { GoogleMobileLoginDto } from './dto/google-mobile-login.dto.js'
import { GuestLoginDto } from './dto/guest-login.dto.js'
import { ProfileDto } from './dto/profile.dto.js'
import { RefreshDto } from './dto/refresh.dto.js'
import { SendOtpDto } from './dto/send-otp.dto.js'
import { VerifyOtpDto } from './dto/verify-otp.dto.js'
import { AppleAuthGuard } from './guards/apple-auth.guard.js'
import { GoogleAuthGuard } from './guards/google-auth.guard.js'
import { JwtAuthGuard } from './guards/jwt-auth.guard.js'

@Controller('v2/auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  // ─── Helper: Extract IP Address ──────────────────────────────────────────────

  private extractIpAddress(req: Request): string | undefined {
    // Check X-Forwarded-For header first (for proxies/load balancers)
    const forwardedFor = req.headers['x-forwarded-for']
    if (forwardedFor) {
      const ips = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor.split(',')[0]
      return ips?.trim()
    }
    // Fallback to req.ip
    return req.ip
  }

  private buildAuthContext(req: Request): {
    deviceId?: string
    ipAddress?: string
    userAgent?: string
    timezone?: string
  } {
    return {
      deviceId: req.headers['x-device-id'] as string | undefined,
      ipAddress: this.extractIpAddress(req),
      userAgent: req.headers['user-agent'],
      timezone: req.headers['x-timezone'] as string | undefined,
    }
  }

  // ─── Google Web ──────────────────────────────────────────────────────────────

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('google')
  async googleAuth() {
    // Guard triggers OAuth redirect to Google
  }

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('google/callback')
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const context = this.buildAuthContext(req)
    const result = await this.authService.googleLogin(
      req.user as Parameters<AuthService['googleLogin']>[0],
      context,
    )
    this.setRefreshCookie(res, result.refreshToken)
    const webAppUrl = this.config.get<string>(
      'WEB_APP_URL',
      'http://localhost:3001',
    )
    const params = new URLSearchParams({
      access: result.accessToken,
      onboarding_required: String(result.onboarding_required),
      login_method: result.login_method,
    })
    return res.redirect(`${webAppUrl}/auth/callback?${params.toString()}`)
  }

  // ─── Google Mobile ───────────────────────────────────────────────────────────

  @Public()
  @Post('google/mobile')
  async googleMobile(@Body() dto: GoogleMobileLoginDto, @Req() req: Request) {
    const context = this.buildAuthContext(req)
    if (!context.deviceId?.trim()) {
      throw new BadRequestException(
        'Device ID is required. Send via header x-device-id.',
      )
    }
    const result = await this.authService.googleMobileLogin(
      dto.idToken,
      context,
    )
    if (context.deviceId) {
      await this.authService.upsertOrTrackDevice({
        deviceId: context.deviceId,
        userId: result.userId,
        platform: req.headers['x-device-platform'] as string | undefined,
        deviceType: req.headers['x-device-type'] as string | undefined,
        deviceName: req.headers['x-device-name'] as string | undefined,
        userAgent: context.userAgent,
      })
    }
    return result
  }

  // ─── Apple Mobile ─────────────────────────────────────────────────────────────

  @Public()
  @Post('apple')
  async apple(@Body() dto: AppleLoginDto, @Req() req: Request) {
    const context = this.buildAuthContext(req)
    if (!context.deviceId?.trim()) {
      throw new BadRequestException(
        'Device ID is required. Send via header x-device-id.',
      )
    }
    const result = await this.authService.appleLogin(dto.identityToken, context)
    if (context.deviceId) {
      await this.authService.upsertOrTrackDevice({
        deviceId: context.deviceId,
        userId: result.userId,
        platform: req.headers['x-device-platform'] as string | undefined,
        deviceType: req.headers['x-device-type'] as string | undefined,
        deviceName: req.headers['x-device-name'] as string | undefined,
        userAgent: context.userAgent,
      })
    }
    return result
  }

  // ─── Apple Web ───────────────────────────────────────────────────────────────

  @Public()
  @UseGuards(AppleAuthGuard)
  @Get('apple/web')
  async appleAuth() {
    // Guard triggers OAuth redirect to Apple
  }

  @Public()
  @UseGuards(AppleAuthGuard)
  @Get('apple/callback')
  async appleCallback(@Req() req: Request, @Res() res: Response) {
    const context = this.buildAuthContext(req)
    const result = await this.authService.appleWebLogin(
      req.user as Parameters<AuthService['appleWebLogin']>[0],
      context,
    )
    this.setRefreshCookie(res, result.refreshToken)
    const webAppUrl = this.config.get<string>(
      'WEB_APP_URL',
      'http://localhost:3001',
    )
    const params = new URLSearchParams({
      access: result.accessToken,
      onboarding_required: String(result.onboarding_required),
      login_method: result.login_method,
    })
    return res.redirect(`${webAppUrl}/auth/callback?${params.toString()}`)
  }

  // ─── Guest (device-linked) ─────────────────────────────────────────────────────

  @Public()
  @Post('guest')
  async guest(
    @Body() dto: GuestLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const context = this.buildAuthContext(req)
    const deviceId =
      (context.deviceId ?? dto?.deviceId)?.trim() || null
    if (!deviceId) {
      throw new BadRequestException(
        'Device ID is required. Send via header x-device-id or body deviceId.',
      )
    }
    const result = await this.authService.guestLogin({
      ...context,
      deviceId,
    })
    this.setRefreshCookie(res, result.refreshToken)
    return result
  }

  // ─── Email OTP ────────────────────────────────────────────────────────────────

  @Public()
  @Post('otp/send')
  sendOtp(@Body() dto: SendOtpDto, @Req() req: Request) {
    const context = this.buildAuthContext(req)
    return this.authService.sendOtp(dto.email, context)
  }

  @Public()
  @Post('otp/verify')
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const baseContext = this.buildAuthContext(req)
    const deviceId =
      (baseContext.deviceId ?? dto?.deviceId)?.trim() || null
    if (!deviceId) {
      throw new BadRequestException(
        'Device ID is required. Send via header x-device-id or body deviceId.',
      )
    }
    const context = { ...baseContext, deviceId }
    const result = await this.authService.verifyOtp(
      dto.email,
      dto.otp,
      context,
    )
    this.setRefreshCookie(res, result.refreshToken)
    if (context.deviceId) {
      await this.authService.upsertOrTrackDevice({
        deviceId: context.deviceId,
        userId: result.userId,
        platform: req.headers['x-device-platform'] as string | undefined,
        deviceType: req.headers['x-device-type'] as string | undefined,
        deviceName: req.headers['x-device-name'] as string | undefined,
        userAgent: context.userAgent,
      })
    }
    return result
  }

  // ─── Refresh ─────────────────────────────────────────────────────────────────

  @Public()
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Body() dto: RefreshDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken =
      (req.cookies as Record<string, string>)?.['refresh_token'] ??
      dto.refreshToken
    if (!rawToken) throw new UnauthorizedException('No refresh token provided')

    const context = this.buildAuthContext(req)
    const result = await this.authService.rotateRefreshToken(rawToken, context)
    this.setRefreshCookie(res, result.refreshToken)
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    }
  }

  // ─── Logout ───────────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Body() dto: RefreshDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken =
      (req.cookies as Record<string, string>)?.['refresh_token'] ??
      dto.refreshToken
    if (rawToken) {
      const context = this.buildAuthContext(req)
      await this.authService.revokeRefreshToken(rawToken, context)
    }
    res.clearCookie('refresh_token')
    return { message: 'Logged out successfully' }
  }

  // ─── Me (JWT payload) ────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Req() req: Request) {
    return req.user
  }

  // ─── Profile ─────────────────────────────────────────────────────────────────
  //
  // GET  /v2/auth/profile  — fetch full profile
  // POST /v2/auth/profile  — submit initial onboarding (marks onboardingStatus COMPLETED)
  // PATCH/PUT /v2/auth/profile  — edit profile fields

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Req() req: Request) {
    const { id } = req.user as { id: string }
    return this.authService.getProfile(id)
  }

  @UseGuards(JwtAuthGuard)
  @Post('profile')
  submitProfile(@Req() req: Request, @Body() dto: ProfileDto) {
    const { id } = req.user as { id: string }
    return this.authService.submitProfile(id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  patchProfile(@Req() req: Request, @Body() dto: ProfileDto) {
    const { id } = req.user as { id: string }
    return this.authService.patchProfile(id, dto)
  }

  // ─── Cookie Helper ────────────────────────────────────────────────────────────

  private setRefreshCookie(res: Response, token: string) {
    const sameSite = this.config.get<'lax' | 'strict' | 'none'>(
      'COOKIE_SAME_SITE',
      'lax',
    )
    res.cookie('refresh_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    })
  }
}
