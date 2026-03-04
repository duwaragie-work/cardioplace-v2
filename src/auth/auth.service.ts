import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { createHash, randomBytes, randomInt } from 'crypto'
import * as nodemailer from 'nodemailer'
import type { Profile } from 'passport-google-oauth20'
import {
  AccountStatus,
  MenopauseStage,
  OnboardingStatus,
  UserRole,
} from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { BcryptService } from './bcrypt.service.js'
import type { ProfileDto } from './dto/profile.dto.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

export interface AuthResponse extends TokenPair {
  userId: string
  onboarding_required: boolean
  user_type: UserRole
  login_method: 'otp' | 'google' | 'apple'
  name: string | null
}

interface MinimalUser {
  id: string
  email: string | null
  name: string | null
  role: UserRole
  onboardingStatus: OnboardingStatus
  accountStatus: AccountStatus
}

export interface ProfileResult {
  message: string
  name: string | null
  dateOfBirth: Date | null
  menopauseStage: MenopauseStage
  timezone: string | null
  onboardingStatus: OnboardingStatus
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function parseDuration(duration: string): number {
  const unit = duration.slice(-1)
  const value = parseInt(duration.slice(0, -1), 10)
  const map: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  }
  return value * (map[unit] ?? 86_400_000)
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private bcryptService: BcryptService,
  ) {}

  // ─── Token Issuance ─────────────────────────────────────────────────────────

  async issueAccessToken(user: MinimalUser): Promise<string> {
    const expiresIn = this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m')
    // @ts-expect-error - NestJS JWT accepts string for expiresIn despite type definition
    return await this.jwtService.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn },
    )
  }

  async issueRefreshToken(userId: string, userAgent?: string): Promise<string> {
    const rawToken = randomBytes(40).toString('hex')
    const tokenHash = sha256(rawToken)
    const expiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d')
    const expiresAt = new Date(Date.now() + parseDuration(expiresIn))

    await this.prisma.refreshToken.create({
      data: { tokenHash, expiresAt, userAgent, userId },
    })

    return rawToken
  }

  async rotateRefreshToken(
    rawToken: string,
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
    },
  ): Promise<TokenPair & { user: MinimalUser }> {
    const tokenHash = sha256(rawToken)

    const existing = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: true },
    })

    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      await this.logAuthEvent({
        event: 'refresh_failed',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'invalid_or_expired_token',
      })
      throw new UnauthorizedException('Invalid or expired refresh token')
    }

    if (existing.user.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(
        `Account is ${existing.user.accountStatus.toLowerCase()}`,
      )
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    })

    const [accessToken, refreshToken] = await Promise.all([
      this.issueAccessToken(existing.user),
      this.issueRefreshToken(existing.userId, context?.userAgent),
    ])

    await this.logAuthEvent({
      event: 'refresh_success',
      userId: existing.user.id,
      deviceId: context?.deviceId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })

    return { accessToken, refreshToken, user: existing.user }
  }

  async revokeRefreshToken(
    rawToken: string,
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
    },
  ): Promise<void> {
    const tokenHash = sha256(rawToken)
    const existing = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null },
      include: { user: true },
    })
    if (!existing) return

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    })

    await this.logAuthEvent({
      event: 'logout',
      userId: existing.userId,
      deviceId: context?.deviceId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })
  }

  private async issueTokenPair(
    user: MinimalUser,
    userAgent?: string,
  ): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.issueAccessToken(user),
      this.issueRefreshToken(user.id, userAgent),
    ])
    return { accessToken, refreshToken }
  }

  private buildAuthResponse(
    tokens: TokenPair,
    user: MinimalUser,
    login_method: 'otp' | 'google' | 'apple',
  ): AuthResponse {
    return {
      ...tokens,
      userId: user.id,
      onboarding_required: user.onboardingStatus !== OnboardingStatus.COMPLETED,
      user_type: user.role,
      login_method,
      name: user.name,
    }
  }

  // ─── Account Status Guard ───────────────────────────────────────────────────

  private assertAccountActive(
    user: Pick<MinimalUser, 'accountStatus'>,
    context?: { event?: string; identifier?: string },
  ): void {
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(
        `Account is ${user.accountStatus.toLowerCase()}`,
      )
    }
  }

  // ─── Auth Logging ───────────────────────────────────────────────────────────

  private async logAuthEvent(params: {
    event: string
    identifier?: string
    userId?: string
    method?: 'otp' | 'google' | 'apple'
    deviceId?: string
    ipAddress?: string
    userAgent?: string
    metadata?: Record<string, unknown>
    success: boolean
    errorCode?: string
  }): Promise<void> {
    try {
      await this.prisma.authLog.create({
        data: {
          event: params.event,
          identifier: params.identifier ?? null,
          userId: params.userId ?? null,
          method: params.method ?? null,
          deviceId: params.deviceId ?? null,
          ipAddress: params.ipAddress ?? null,
          userAgent: params.userAgent ?? null,
          metadata: params.metadata
            ? JSON.parse(JSON.stringify(params.metadata))
            : null,
          success: params.success,
          errorCode: params.errorCode ?? null,
        },
      })
    } catch (error) {
      // Never let logging failures break the auth flow
      console.error('Failed to log auth event:', error)
    }
  }

  // ─── Timezone Auto-Update ───────────────────────────────────────────────────

  private async silentlyUpdateTimezone(
    userId: string,
    timezone?: string,
  ): Promise<void> {
    if (!timezone || !timezone.includes('/')) return
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { timezone },
      })
    } catch (error) {
      console.error('Failed to update timezone:', error)
    }
  }

  // ─── Google Web Flow ────────────────────────────────────────────────────────

  async googleLogin(
    profile: Profile,
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
      timezone?: string
    },
  ): Promise<AuthResponse> {
    const providerId = profile.id
    const rawEmail = profile.emails?.[0]?.value ?? null
    const emailVerified =
      (profile.emails?.[0] as { verified?: boolean })?.verified ?? false

    try {
      const user = await this.upsertSocialUser(
        'google',
        providerId,
        rawEmail,
        emailVerified,
        profile.displayName,
      )
      this.assertAccountActive(user)
      await this.silentlyUpdateTimezone(user.id, context?.timezone)
      const tokens = await this.issueTokenPair(user, context?.userAgent)

      await this.logAuthEvent({
        event: 'social_login_success',
        identifier: rawEmail ?? undefined,
        userId: user.id,
        method: 'google',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { providerId },
        success: true,
      })

      return this.buildAuthResponse(tokens, user, 'google')
    } catch (err) {
      if (!(err instanceof ForbiddenException)) {
        await this.logAuthEvent({
          event: 'social_login_failed',
          identifier: rawEmail ?? undefined,
          method: 'google',
          deviceId: context?.deviceId,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: { providerId },
          success: false,
          errorCode: 'google_login_error',
        })
      }
      throw err
    }
  }

  // ─── Google Mobile Flow ─────────────────────────────────────────────────────

  async googleMobileLogin(
    idToken: string,
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
      timezone?: string
    },
  ): Promise<AuthResponse> {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`,
    )

    if (!res.ok) {
      await this.logAuthEvent({
        event: 'social_login_failed',
        method: 'google',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'invalid_google_token',
      })
      throw new UnauthorizedException('Invalid Google token')
    }

    const claims = (await res.json()) as {
      sub: string
      email?: string
      email_verified?: string
      name?: string
      aud: string
    }

    const expectedAud = this.config.get<string>('GOOGLE_CLIENT_ID')
    if (claims.aud !== expectedAud) {
      await this.logAuthEvent({
        event: 'social_login_failed',
        identifier: claims.email,
        method: 'google',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { providerId: claims.sub },
        success: false,
        errorCode: 'audience_mismatch',
      })
      throw new UnauthorizedException('Google token audience mismatch')
    }

    try {
      const emailVerified = claims.email_verified === 'true'
      const user = await this.upsertSocialUser(
        'google',
        claims.sub,
        claims.email ?? null,
        emailVerified,
        claims.name,
      )
      this.assertAccountActive(user)
      await this.silentlyUpdateTimezone(user.id, context?.timezone)
      const tokens = await this.issueTokenPair(user, context?.userAgent)

      await this.logAuthEvent({
        event: 'social_login_success',
        identifier: claims.email,
        userId: user.id,
        method: 'google',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { providerId: claims.sub },
        success: true,
      })

      return this.buildAuthResponse(tokens, user, 'google')
    } catch (err) {
      if (!(err instanceof ForbiddenException)) {
        await this.logAuthEvent({
          event: 'social_login_failed',
          identifier: claims.email,
          method: 'google',
          deviceId: context?.deviceId,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: { providerId: claims.sub },
          success: false,
          errorCode: 'google_mobile_login_error',
        })
      }
      throw err
    }
  }

  // ─── Apple Mobile Flow ──────────────────────────────────────────────────────

  async appleLogin(
    identityToken: string,
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
      timezone?: string
    },
  ): Promise<AuthResponse> {
    const appleSignin = await import('apple-signin-auth')
    const clientId = this.config.get<string>('APPLE_CLIENT_ID', '')

    let claims: { sub: string; email?: string }
    try {
      claims = await appleSignin.default.verifyIdToken(identityToken, {
        audience: clientId,
        ignoreExpiration: false,
      })
    } catch {
      await this.logAuthEvent({
        event: 'social_login_failed',
        method: 'apple',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'invalid_apple_token',
      })
      throw new UnauthorizedException('Invalid Apple token')
    }

    try {
      const user = await this.upsertSocialUser(
        'apple',
        claims.sub,
        claims.email ?? null,
        false,
      )
      this.assertAccountActive(user)
      await this.silentlyUpdateTimezone(user.id, context?.timezone)
      const tokens = await this.issueTokenPair(user, context?.userAgent)

      await this.logAuthEvent({
        event: 'social_login_success',
        identifier: claims.email,
        userId: user.id,
        method: 'apple',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { providerId: claims.sub },
        success: true,
      })

      return this.buildAuthResponse(tokens, user, 'apple')
    } catch (err) {
      if (!(err instanceof ForbiddenException)) {
        await this.logAuthEvent({
          event: 'social_login_failed',
          identifier: claims.email,
          method: 'apple',
          deviceId: context?.deviceId,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: { providerId: claims.sub },
          success: false,
          errorCode: 'apple_login_error',
        })
      }
      throw err
    }
  }

  // ─── Apple Web Flow ─────────────────────────────────────────────────────────

  async appleWebLogin(
    profile: {
      id: string
      email?: string
      name?: { firstName?: string; lastName?: string }
    },
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
      timezone?: string
    },
  ): Promise<AuthResponse> {
    const providerId = profile.id
    const email = profile.email ?? null
    const fullName = profile.name
      ? `${profile.name.firstName ?? ''} ${profile.name.lastName ?? ''}`.trim()
      : undefined

    try {
      const user = await this.upsertSocialUser(
        'apple',
        providerId,
        email,
        false,
        fullName,
      )
      this.assertAccountActive(user)
      await this.silentlyUpdateTimezone(user.id, context?.timezone)
      const tokens = await this.issueTokenPair(user, context?.userAgent)

      await this.logAuthEvent({
        event: 'social_login_success',
        identifier: email ?? undefined,
        userId: user.id,
        method: 'apple',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { providerId },
        success: true,
      })

      return this.buildAuthResponse(tokens, user, 'apple')
    } catch (err) {
      if (!(err instanceof ForbiddenException)) {
        await this.logAuthEvent({
          event: 'social_login_failed',
          identifier: email ?? undefined,
          method: 'apple',
          deviceId: context?.deviceId,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: { providerId },
          success: false,
          errorCode: 'apple_web_login_error',
        })
      }
      throw err
    }
  }

  // ─── Shared Social Upsert ───────────────────────────────────────────────────

  private async upsertSocialUser(
    provider: 'google' | 'apple',
    providerId: string,
    email: string | null,
    emailVerified: boolean,
    name?: string,
  ): Promise<MinimalUser> {
    const existingAccount = await this.prisma.account.findUnique({
      where: { provider_providerId: { provider, providerId } },
      include: { user: true },
    })
    if (existingAccount) return existingAccount.user

    if (provider === 'google' && email && emailVerified) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email },
      })
      if (existingUser) {
        await this.prisma.account.create({
          data: { provider, providerId, email, userId: existingUser.id },
        })
        return existingUser
      }
    }

    const user = await this.prisma.user.create({
      data: {
        email: email ?? null,
        name: name ?? null,
        isVerified: emailVerified,
        role: UserRole.REGISTERED_USER,
        accounts: {
          create: { provider, providerId, email },
        },
      },
    })
    return user
  }

  // ─── Email OTP — Send ───────────────────────────────────────────────────────

  async sendOtp(
    email: string,
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
    },
  ): Promise<{ message: string }> {
    if (!email?.trim()) {
      throw new BadRequestException('Email is required')
    }

    const normalizedEmail = email.trim().toLowerCase()

    // Check account status for existing users before sending OTP
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { accountStatus: true },
    })
    if (existingUser && existingUser.accountStatus !== AccountStatus.ACTIVE) {
      await this.logAuthEvent({
        event: 'otp_blocked',
        identifier: normalizedEmail,
        method: 'otp',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'account_not_active',
      })
      throw new ForbiddenException(
        `Account is ${existingUser.accountStatus.toLowerCase()}`,
      )
    }

    // Check for recent OTP request (rate limiting)
    const recentOtp = await this.prisma.otpCode.findFirst({
      where: {
        email: normalizedEmail,
        createdAt: { gt: new Date(Date.now() - 60_000) },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (recentOtp) {
      throw new BadRequestException(
        'Please wait 60 seconds before requesting a new OTP',
      )
    }

    const otp = randomInt(100_000, 1_000_000).toString()
    const codeHash = await this.bcryptService.hash(otp)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    await this.prisma.otpCode.create({
      data: { email: normalizedEmail, codeHash, expiresAt },
    })

    await this.sendOtpEmail(normalizedEmail, otp)

    // Log the OTP request event
    await this.logAuthEvent({
      event: 'otp_requested',
      identifier: normalizedEmail,
      method: 'otp',
      deviceId: context?.deviceId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })

    return { message: 'OTP sent successfully' }
  }

  // ─── Email OTP — Verify ─────────────────────────────────────────────────────

  async verifyOtp(
    email: string,
    code: string,
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
      timezone?: string
    },
  ): Promise<AuthResponse> {
    if (!email?.trim()) {
      throw new BadRequestException('Email is required')
    }

    const normalizedEmail = email.trim().toLowerCase()

    // Find the most recent unexpired OTP
    const otpRecord = await this.prisma.otpCode.findFirst({
      where: {
        email: normalizedEmail,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!otpRecord) {
      await this.logAuthEvent({
        event: 'otp_expired',
        identifier: normalizedEmail,
        method: 'otp',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'otp_not_found_or_expired',
      })
      throw new BadRequestException('OTP not found or expired')
    }

    // Check if max attempts reached
    if (otpRecord.attempts >= 5) {
      await this.logAuthEvent({
        event: 'otp_locked',
        identifier: normalizedEmail,
        method: 'otp',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { attempts: otpRecord.attempts },
        success: false,
        errorCode: 'max_attempts_exceeded',
      })
      // Delete the locked OTP
      await this.prisma.otpCode.delete({ where: { id: otpRecord.id } })
      throw new BadRequestException(
        'Too many incorrect attempts. Request a new OTP.',
      )
    }

    // Verify the code
    const valid = await this.bcryptService.compare(code, otpRecord.codeHash)
    if (!valid) {
      // Increment attempt counter
      const updatedOtp = await this.prisma.otpCode.update({
        where: { id: otpRecord.id },
        data: { attempts: otpRecord.attempts + 1 },
      })

      await this.logAuthEvent({
        event: 'otp_failed',
        identifier: normalizedEmail,
        method: 'otp',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { attempts: updatedOtp.attempts },
        success: false,
        errorCode: 'invalid_code',
      })

      throw new BadRequestException('Invalid OTP')
    }

    // OTP is valid - upsert user
    let user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: normalizedEmail,
          isVerified: true,
          role: UserRole.REGISTERED_USER,
        },
      })
    } else if (!user.isVerified) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { isVerified: true },
      })
    }

    // Enforce account status before issuing tokens
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      await this.prisma.otpCode.delete({ where: { id: otpRecord.id } })
      await this.logAuthEvent({
        event: 'otp_blocked',
        identifier: normalizedEmail,
        userId: user.id,
        method: 'otp',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'account_not_active',
      })
      throw new ForbiddenException(
        `Account is ${user.accountStatus.toLowerCase()}`,
      )
    }

    await this.prisma.otpCode.delete({ where: { id: otpRecord.id } })

    // Update timezone on every successful login (silently)
    await this.silentlyUpdateTimezone(user.id, context?.timezone)

    // Log successful verification
    await this.logAuthEvent({
      event: 'otp_verified',
      identifier: normalizedEmail,
      userId: user.id,
      method: 'otp',
      deviceId: context?.deviceId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })

    const tokens = await this.issueTokenPair(user, context?.userAgent)
    return this.buildAuthResponse(tokens, user, 'otp')
  }

  // ─── Device Tracking ────────────────────────────────────────────────────────

  async upsertOrTrackDevice(opts: {
    deviceId: string
    userId?: string
    platform?: string
    deviceType?: string
    deviceName?: string
    userAgent?: string
  }): Promise<void> {
    await this.prisma.device.upsert({
      where: { deviceId: opts.deviceId },
      create: {
        deviceId: opts.deviceId,
        userId: opts.userId ?? null,
        platform: opts.platform,
        deviceType: opts.deviceType,
        deviceName: opts.deviceName,
        userAgent: opts.userAgent,
      },
      update: {
        lastSeenAt: new Date(),
        userId: opts.userId ?? undefined,
        platform: opts.platform ?? undefined,
        deviceType: opts.deviceType ?? undefined,
        deviceName: opts.deviceName ?? undefined,
        userAgent: opts.userAgent,
      },
    })
  }

  // ─── Profile — Submit (POST: initial onboarding or first-time save) ──────────

  async submitProfile(userId: string, dto: ProfileDto): Promise<ProfileResult> {
    const patch = this.buildProfilePatch(dto)

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { ...patch, onboardingStatus: OnboardingStatus.COMPLETED },
      select: {
        name: true,
        dateOfBirth: true,
        menopauseStage: true,
        timezone: true,
        onboardingStatus: true,
      },
    })

    return { message: 'Profile saved', ...updated }
  }

  // ─── Profile — Patch (PATCH: edit existing profile) ──────────────────────────

  async patchProfile(userId: string, dto: ProfileDto): Promise<ProfileResult> {
    const patch = this.buildProfilePatch(dto)

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: patch,
      select: {
        name: true,
        dateOfBirth: true,
        menopauseStage: true,
        timezone: true,
        onboardingStatus: true,
      },
    })

    return { message: 'Profile updated', ...updated }
  }

  private buildProfilePatch(dto: ProfileDto) {
    const patch: {
      name?: string
      dateOfBirth?: Date | null
      menopauseStage?: MenopauseStage
      timezone?: string
    } = {}

    if (dto.name !== undefined) patch.name = dto.name
    if (dto.dateOfBirth !== undefined) {
      patch.dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null
    }
    if (dto.menopauseStage !== undefined) {
      patch.menopauseStage = dto.menopauseStage as MenopauseStage
    }
    if (dto.timezone !== undefined) patch.timezone = dto.timezone

    return patch
  }

  // ─── Profile — Get ────────────────────────────────────────────────────────────

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isVerified: true,
        onboardingStatus: true,
        accountStatus: true,
        dateOfBirth: true,
        menopauseStage: true,
        timezone: true,
        createdAt: true,
      },
    })

    if (!user) {
      throw new NotFoundException('User not found')
    }

    return user
  }

  // ─── Email Helper ────────────────────────────────────────────────────────────

  private async sendOtpEmail(email: string, otp: string): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: Number(this.config.get<string>('SMTP_PORT', '587')),
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    })

    await transporter.sendMail({
      from: this.config.get<string>(
        'SMTP_FROM',
        'Healplace <no-reply@healplace.com>',
      ),
      to: email,
      subject: 'Your Healplace verification code',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #1a1a2e;">Your verification code</h2>
          <p style="font-size: 36px; font-weight: bold; letter-spacing: 10px;
                     color: #4f46e5; background: #f5f3ff; padding: 16px;
                     border-radius: 8px; text-align: center;">
            ${otp}
          </p>
          <p>This code expires in <strong>10 minutes</strong>.</p>
          <p style="color: #6b7280; font-size: 13px;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
      `,
    })
  }
}
