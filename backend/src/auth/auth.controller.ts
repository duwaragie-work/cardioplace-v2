import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import { UserRole } from '../generated/prisma/enums.js'
import { AuthService } from './auth.service.js'
import { Public } from './decorators/public.decorator.js'
import { ProfileDto } from './dto/profile.dto.js'
import { RefreshDto } from './dto/refresh.dto.js'
import { SendOtpDto } from './dto/send-otp.dto.js'
import { VerifyOtpDto } from './dto/verify-otp.dto.js'
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

  /* ═══ DISABLED – OTP-only auth ═══════════════════════════════════════════════
   * Google Web, Google Mobile, Apple Mobile, Apple Web, and Guest login routes
   * have been disabled. Only OTP-based authentication is supported.
   * To re-enable, uncomment the routes below and restore the corresponding
   * imports, strategies, and guards in auth.module.ts.
   * ══════════════════════════════════════════════════════════════════════════════ */

  // ─── Email OTP ────────────────────────────────────────────────────────────────

  @Public()
  @Post('otp/send')
  sendOtp(@Body() dto: SendOtpDto, @Req() req: Request) {
    const context = { ...this.buildAuthContext(req), appContext: dto.appContext }
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
    const context = { ...baseContext, deviceId, appContext: dto.appContext }
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

  // ─── Magic Link ────────────────────────────────────────────────────────────────

  @Public()
  @Post('magic-link/send')
  sendMagicLink(@Body() dto: SendOtpDto, @Req() req: Request) {
    const context = this.buildAuthContext(req)
    return this.authService.sendMagicLink(dto.email, context)
  }

  @Public()
  @Get('magic-link/verify')
  async verifyMagicLink(
    @Query('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const [patientAppUrl, adminAppUrl] = this.config
      .get<string>('WEB_APP_URL', 'http://localhost:3000,http://localhost:3001')
      .split(',')
      .map((u) => u.trim())

    try {
      const context = this.buildAuthContext(req)
      const result = await this.authService.verifyMagicLink(token, context)
      this.setRefreshCookie(res, result.refreshToken)

      const targetUrl = result.roles.includes(UserRole.SUPER_ADMIN)
        ? (adminAppUrl ?? patientAppUrl)
        : patientAppUrl

      const params = new URLSearchParams({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        userId: result.userId,
        email: result.email ?? '',
        name: result.name ?? '',
        roles: result.roles.join(','),
        login_method: result.login_method,
        onboarding_required: String(result.onboarding_required),
      })
      res.redirect(`${targetUrl}/auth/magic-link?${params.toString()}`)
    } catch {
      res.redirect(`${patientAppUrl}/auth/magic-link?error=expired`)
    }
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
