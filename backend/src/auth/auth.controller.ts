import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
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
import {
  type CookieScope,
  cookieName,
  deriveCookieScope,
  LEGACY_ACCESS_COOKIE,
  LEGACY_REFRESH_COOKIE,
  scopeForRoles,
} from './cookie-scope.js'
import { ActiveContext } from './decorators/active-context.decorator.js'
import { Public } from './decorators/public.decorator.js'
import { ConsentDto } from './dto/consent.dto.js'
import { ProfileDto } from './dto/profile.dto.js'
import { RefreshDto } from './dto/refresh.dto.js'
import { SelectPracticeDto, SwitchPracticeDto } from './dto/select-practice.dto.js'
import { SendOtpDto } from './dto/send-otp.dto.js'
import { VerifyOtpDto } from './dto/verify-otp.dto.js'
import {
  AdminResetMfaDto,
  EnrollCompleteDto,
  MfaChallengeDto,
  MfaRecoveryDto,
} from './dto/mfa.dto.js'
import { Roles } from './decorators/roles.decorator.js'
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
    deviceType?: string
  } {
    const userAgent = req.headers['user-agent']
    return {
      deviceId: req.headers['x-device-id'] as string | undefined,
      ipAddress: this.extractIpAddress(req),
      userAgent,
      timezone: req.headers['x-timezone'] as string | undefined,
      deviceType: this.resolveDeviceType(
        req.headers['x-device-platform'] as string | undefined,
        userAgent,
      ),
    }
  }

  /**
   * Resolve the canonical device type for AuthSession.deviceType. The
   * explicit `x-device-platform` header (sent by the mobile shell) wins;
   * otherwise we fall back to a basic User-Agent mobile-token scan so
   * regular browser sessions still pick the right idle threshold
   * (Phase 2: 15 min web / 5 min mobile).
   */
  private resolveDeviceType(
    platform: string | undefined,
    userAgent: string | undefined,
  ): 'web' | 'mobile' {
    const normalized = platform?.trim().toLowerCase()
    if (normalized === 'mobile' || normalized === 'ios' || normalized === 'android') {
      return 'mobile'
    }
    if (normalized === 'web') return 'web'
    if (userAgent && /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) {
      return 'mobile'
    }
    return 'web'
  }

  /** Set the app-scoped access + refresh cookies from an issued token pair.
   *  Shared by the MFA challenge/recovery handlers (mirrors /otp/verify). */
  private issueSessionCookies(
    res: Response,
    result: { accessToken: string; refreshToken: string; roles: UserRole[] },
  ): void {
    const scope = scopeForRoles(result.roles)
    this.setAccessCookie(res, result.accessToken, scope)
    this.setRefreshCookie(res, result.refreshToken, scope)
  }

  /** Upsert/track the calling device after a successful sign-in (mirrors the
   *  device-tracking step in /otp/verify). No-op when no device id is sent. */
  private async trackDevice(
    req: Request,
    context: { deviceId?: string; userAgent?: string },
    userId: string,
  ): Promise<void> {
    if (!context.deviceId) return
    await this.authService.upsertOrTrackDevice({
      deviceId: context.deviceId,
      userId,
      platform: req.headers['x-device-platform'] as string | undefined,
      deviceType: req.headers['x-device-type'] as string | undefined,
      deviceName: req.headers['x-device-name'] as string | undefined,
      userAgent: context.userAgent,
    })
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
    const context = {
      ...this.buildAuthContext(req),
      appContext: dto.appContext,
    }
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
    const deviceId = (baseContext.deviceId ?? dto?.deviceId)?.trim() || null
    if (!deviceId) {
      throw new BadRequestException(
        'Device ID is required. Send via header x-device-id or body deviceId.',
      )
    }
    const context = { ...baseContext, deviceId, appContext: dto.appContext }
    const result = await this.authService.verifyOtp(dto.email, dto.otp, context)
    // Phase/practice-identity — multi-practice provider gets a challenge
    // token instead of the real token pair. Return the discriminator shape
    // verbatim; the FE selector page POSTs /select-practice next.
    if ('status' in result && result.status === 'PRACTICE_SELECT_REQUIRED') {
      return result
    }
    // MFA gate — an enrolled provider/admin gets a challenge, not tokens.
    // Pass the discriminator through verbatim; the FE routes to the TOTP
    // challenge page and POSTs /mfa/challenge next.
    if ('status' in result && result.status === 'MFA_REQUIRED') {
      return result
    }
    // Scope cookies to the destination app (admin-role users land on the
    // admin app — including via the patient→admin sign-in bridge, where
    // this POST's Origin is the patient origin but the session is admin's).
    const scope = scopeForRoles(result.roles)
    this.setAccessCookie(res, result.accessToken, scope)
    this.setRefreshCookie(res, result.refreshToken, scope)
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

  // ─── Practice Selector + Switcher ──────────────────────────────────────────
  // Phase/practice-identity (Manisha 2026-06-12 Access Control §1).
  //
  // select-practice  — exchange a practice-select challenge token (issued by
  //                    /otp/verify or /magic-link/verify when the user has
  //                    2+ memberships) for the real token pair, with the
  //                    chosen practice persisted on the new AuthSession.
  // switch-practice  — mid-session active-practice swap. No new tokens.

  @Public()
  @Post('select-practice')
  async selectPractice(
    @Body() dto: SelectPracticeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const context = this.buildAuthContext(req)
    const result = await this.authService.selectPractice(
      dto.challengeToken,
      dto.practiceId,
      context,
    )
    // MFA gate — multi-practice provider/admin who is enrolled gets a
    // challenge after picking a practice; no tokens/cookies yet.
    if ('status' in result && result.status === 'MFA_REQUIRED') {
      return result
    }
    const scope = scopeForRoles(result.roles)
    this.setAccessCookie(res, result.accessToken, scope)
    this.setRefreshCookie(res, result.refreshToken, scope)
    return result
  }

  @UseGuards(JwtAuthGuard)
  @Post('switch-practice')
  async switchPractice(
    @Body() dto: SwitchPracticeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { id } = req.user as { id: string }
    // Identify WHICH AuthSession on this device the user is acting on.
    // Read the refresh-token cookie (same shape as the /refresh handler);
    // service-side resolves it to the AuthSession.refreshTokenId.
    const scope = deriveCookieScope(req)
    const cookies = (req.cookies as Record<string, string>) ?? {}
    const rawRefreshToken =
      cookies[cookieName(scope, 'refresh')] ?? cookies[LEGACY_REFRESH_COOKIE]
    if (!rawRefreshToken) {
      throw new BadRequestException(
        'No active session — sign in again to switch practices.',
      )
    }
    const context = this.buildAuthContext(req)
    const result = await this.authService.switchPracticeByRefreshToken(
      id,
      rawRefreshToken,
      dto.practiceId,
      context,
    )
    // Mint replaces the access cookie so the next request carries the new
    // activePracticeId JWT claim immediately.
    this.setAccessCookie(res, result.accessToken, scope)
    return result
  }

  // ─── MFA — TOTP second factor (Manisha 2026-06-12 Access Control §6) ────────

  // Enrollment is performed by an authenticated (post-first-factor) user, so
  // these two routes rely on the default JwtAuthGuard and read req.user.

  @Post('mfa/enroll/start')
  async mfaEnrollStart(@Req() req: Request) {
    const { id } = req.user as { id: string }
    return this.authService.startTotpEnrollment(id, this.buildAuthContext(req))
  }

  @Post('mfa/enroll/complete')
  async mfaEnrollComplete(@Body() dto: EnrollCompleteDto, @Req() req: Request) {
    const { id } = req.user as { id: string }
    return this.authService.completeTotpEnrollment(
      id,
      dto.enrollmentToken,
      dto.code,
      this.buildAuthContext(req),
    )
  }

  // Regenerate recovery codes for an already-enrolled user (profile Security
  // surface). Authenticated; the enrolled user passes the MfaRequiredGuard.
  @Post('mfa/recovery-codes/regenerate')
  async mfaRegenerateRecoveryCodes(@Req() req: Request) {
    const { id } = req.user as { id: string }
    return this.authService.regenerateRecoveryCodes(id, this.buildAuthContext(req))
  }

  // Challenge + recovery run pre-token (the user only holds the short-lived
  // challenge token), so they're Public and issue + set cookies on success.

  @Public()
  @Post('mfa/challenge')
  async mfaChallenge(
    @Body() dto: MfaChallengeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const context = this.buildAuthContext(req)
    const result = await this.authService.mfaChallenge(
      dto.challengeToken,
      dto.code,
      context,
    )
    this.issueSessionCookies(res, result)
    await this.trackDevice(req, context, result.userId)
    return result
  }

  @Public()
  @Post('mfa/recovery')
  async mfaRecovery(
    @Body() dto: MfaRecoveryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const context = this.buildAuthContext(req)
    const result = await this.authService.mfaRecovery(
      dto.challengeToken,
      dto.recoveryCode,
      context,
    )
    this.issueSessionCookies(res, result)
    await this.trackDevice(req, context, result.userId)
    return result
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.HEALPLACE_OPS)
  @Post('admin/mfa/reset/:userId')
  async adminResetMfa(
    @Param('userId') userId: string,
    @Body() dto: AdminResetMfaDto,
    @Req() req: Request,
  ) {
    const { id } = req.user as { id: string }
    return this.authService.adminResetMfa(
      id,
      userId,
      dto.reason,
      this.buildAuthContext(req),
    )
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
      // Phase/practice-identity — magic-link can also surface the selector
      // requirement when the recipient is a multi-practice provider. Redirect
      // to the FE selector page carrying the short-lived challenge token.
      if ('status' in result && result.status === 'PRACTICE_SELECT_REQUIRED') {
        const sp = new URLSearchParams({
          challengeToken: result.challengeToken,
          practices: JSON.stringify(result.practices),
        })
        res.redirect(`${adminAppUrl ?? patientAppUrl}/sign-in/select-practice?${sp.toString()}`)
        return
      }
      // MFA gate — if an enrolled provider/admin ever arrives via magic link,
      // bounce to the TOTP challenge page carrying the challenge token (mirrors
      // the selector redirect above). Patients have no TOTP so never hit this.
      if ('status' in result && result.status === 'MFA_REQUIRED') {
        const sp = new URLSearchParams({ challengeToken: result.challengeToken })
        res.redirect(`${adminAppUrl ?? patientAppUrl}/sign-in/mfa-challenge?${sp.toString()}`)
        return
      }
      // Magic-link verify is a top-level GET (clicked from an email) so the
      // browser sends no Origin — derive scope from the verified roles, the
      // same signal that picks targetUrl below.
      const scope = scopeForRoles(result.roles)
      this.setAccessCookie(res, result.accessToken, scope)
      this.setRefreshCookie(res, result.refreshToken, scope)

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

  // ─── User Invite Activation ─────────────────────────────────────────────────
  //
  // Two endpoints power the invite activation flow:
  //   GET  /v2/auth/invite/:token         — probe: render details + check validity
  //   POST /v2/auth/invite/:token/accept  — claim: create user + issue session
  //
  // Both are @Public() because the invitee doesn't have a session yet —
  // the raw token in the URL is the one-time secret that authenticates them.

  @Public()
  @Get('invite/:token')
  lookupInvite(@Param('token') token: string) {
    return this.authService.lookupInvite(token)
  }

  @Public()
  @Post('invite/:token/accept')
  async acceptInvite(
    @Param('token') token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const context = this.buildAuthContext(req)
    const result = await this.authService.acceptInvite(token, context)
    // Scope cookies to the destination app — same logic as
    // verifyMagicLink / verifyOtp: admin-role users land on admin.
    const scope = scopeForRoles(result.roles)
    this.setAccessCookie(res, result.accessToken, scope)
    this.setRefreshCookie(res, result.refreshToken, scope)
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
    // Each app refreshes from its own origin, so Origin reliably identifies
    // the scope here. Read the scoped cookie first, then the pre-fix
    // unscoped name (so sessions created before this change keep working),
    // then the body (legacy non-browser clients).
    const scope = deriveCookieScope(req)
    const cookies = (req.cookies as Record<string, string>) ?? {}
    const rawToken =
      cookies[cookieName(scope, 'refresh')] ??
      cookies[LEGACY_REFRESH_COOKIE] ??
      dto.refreshToken
    if (!rawToken) throw new UnauthorizedException('No refresh token provided')

    const context = this.buildAuthContext(req)
    const result = await this.authService.rotateRefreshToken(rawToken, context)
    this.setAccessCookie(res, result.accessToken, scope)
    this.setRefreshCookie(res, result.refreshToken, scope)
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
    const scope = deriveCookieScope(req)
    const cookies = (req.cookies as Record<string, string>) ?? {}
    const rawToken =
      cookies[cookieName(scope, 'refresh')] ??
      cookies[LEGACY_REFRESH_COOKIE] ??
      dto.refreshToken
    if (rawToken) {
      const context = this.buildAuthContext(req)
      await this.authService.revokeRefreshToken(rawToken, context)
    }
    // Clear must mirror the setter's attribute set exactly. Browsers ignore
    // a clearCookie whose `secure`, `sameSite`, `path`, or `domain` doesn't
    // match the original Set-Cookie — the cookie silently survives. Reuse
    // `cookieDefaults()` so setter + clearer share one source of truth.
    //
    // Clear ONLY this app's scoped cookies (+ the pre-fix unscoped names so
    // legacy local sessions wipe). Deliberately do NOT touch the other
    // scope: signing out of the patient app must leave a concurrent admin
    // session intact, and vice versa — that's the whole point of scoping.
    const clearOpts = { ...this.cookieDefaults(), path: '/' }
    res.clearCookie(cookieName(scope, 'access'), clearOpts)
    res.clearCookie(cookieName(scope, 'refresh'), clearOpts)
    res.clearCookie(LEGACY_ACCESS_COOKIE, clearOpts)
    res.clearCookie(LEGACY_REFRESH_COOKIE, clearOpts)
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
  getProfile(
    @Req() req: Request,
    @ActiveContext() ctx: { practiceId: string | null },
  ) {
    const { id } = req.user as { id: string }
    return this.authService.getProfile(id, ctx)
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

  // ─── Consent (Terms + Privacy acknowledgment) ─────────────────────────────────
  //
  // POST /v2/auth/consent — record that the signed-in patient agreed to the
  // current Terms + Privacy version. Called once by the post-login consent gate
  // on the onboarding privacy step (returning users who already agreed never
  // reach it). Writes a `policy_acknowledged` event to the AuthLog audit trail.

  @UseGuards(JwtAuthGuard)
  @Post('consent')
  recordConsent(@Req() req: Request, @Body() dto: ConsentDto) {
    const { id } = req.user as { id: string }
    const ctx = this.buildAuthContext(req)
    return this.authService.recordConsent(id, dto.policyVersion, {
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  }

  // ─── Cookie Helpers ───────────────────────────────────────────────────────────

  private cookieDefaults() {
    const sameSite = this.config.get<'lax' | 'strict' | 'none'>(
      'COOKIE_SAME_SITE',
      'lax',
    )
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite,
    } as const
  }

  private setAccessCookie(res: Response, token: string, scope: CookieScope) {
    // 7 day max-age — shorter than refresh but long enough to survive idle
    // tabs without the Bearer-fallback re-prompting; the backend's actual
    // JWT expiry (JWT_ACCESS_EXPIRES_IN, default 15m) is the real lifetime.
    res.cookie(cookieName(scope, 'access'), token, {
      ...this.cookieDefaults(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
  }

  private setRefreshCookie(res: Response, token: string, scope: CookieScope) {
    res.cookie(cookieName(scope, 'refresh'), token, {
      ...this.cookieDefaults(),
      maxAge: 30 * 24 * 60 * 60 * 1000,
    })
  }
}
