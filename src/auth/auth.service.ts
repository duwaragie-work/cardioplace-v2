import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { createHash, randomBytes, randomInt } from 'crypto'
import nodemailer from 'nodemailer'
import type { Profile } from 'passport-google-oauth20'
import { UserRole } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

export interface AuthResponse extends TokenPair {
  onboarding_required: boolean
  user_type: UserRole // e.g. "GUEST", "REGISTERED_USER"
  login_method: 'otp' | 'google' | 'apple' 
}

interface MinimalUser {
  id: string
  email: string | null
  role: UserRole
  onboardingCompleted: boolean
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
    userAgent?: string,
  ): Promise<TokenPair & { user: MinimalUser }> {
    const tokenHash = sha256(rawToken)

    const existing = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: true },
    })

    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token')
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    })

    const [accessToken, refreshToken] = await Promise.all([
      this.issueAccessToken(existing.user),
      this.issueRefreshToken(existing.userId, userAgent),
    ])

    return { accessToken, refreshToken, user: existing.user }
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = sha256(rawToken)
    const existing = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null },
    })
    if (!existing) return
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
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
      onboarding_required: !user.onboardingCompleted,
      user_type: user.role,
      login_method,
    }
  }

  // ─── Google Web Flow ────────────────────────────────────────────────────────

  async googleLogin(
    profile: Profile,
    userAgent?: string,
  ): Promise<AuthResponse> {
    const providerId = profile.id
    const rawEmail = profile.emails?.[0]?.value ?? null
    const emailVerified =
      (profile.emails?.[0] as { verified?: boolean })?.verified ?? false

    const user = await this.upsertSocialUser(
      'google',
      providerId,
      rawEmail,
      emailVerified,
      profile.displayName,
    )
    const tokens = await this.issueTokenPair(user, userAgent)
    return this.buildAuthResponse(tokens, user, 'google')
  }

  // ─── Google Mobile Flow ─────────────────────────────────────────────────────

  async googleMobileLogin(
    idToken: string,
    userAgent?: string,
  ): Promise<AuthResponse> {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`,
    )

    if (!res.ok) {
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
      throw new UnauthorizedException('Google token audience mismatch')
    }

    const emailVerified = claims.email_verified === 'true'
    const user = await this.upsertSocialUser(
      'google',
      claims.sub,
      claims.email ?? null,
      emailVerified,
      claims.name,
    )
    const tokens = await this.issueTokenPair(user, userAgent)
    return this.buildAuthResponse(tokens, user, 'google')
  }

  // ─── Apple Mobile Flow ──────────────────────────────────────────────────────

  async appleLogin(
    identityToken: string,
    userAgent?: string,
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
      throw new UnauthorizedException('Invalid Apple token')
    }

    const user = await this.upsertSocialUser(
      'apple',
      claims.sub,
      claims.email ?? null,
      false,
    )
    const tokens = await this.issueTokenPair(user, userAgent)
    return this.buildAuthResponse(tokens, user, 'apple')
  }

  // ─── Apple Web Flow ─────────────────────────────────────────────────────────

  async appleWebLogin(
    profile: {
      id: string
      email?: string
      name?: { firstName?: string; lastName?: string }
    },
    userAgent?: string,
  ): Promise<AuthResponse> {
    const providerId = profile.id
    const email = profile.email ?? null
    const fullName = profile.name
      ? `${profile.name.firstName ?? ''} ${profile.name.lastName ?? ''}`.trim()
      : undefined

    const user = await this.upsertSocialUser(
      'apple',
      providerId,
      email,
      false,
      fullName,
    )
    const tokens = await this.issueTokenPair(user, userAgent)
    return this.buildAuthResponse(tokens, user, 'apple')
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

  async sendOtp(email: string): Promise<{ message: string }> {
    if (!email?.trim()) {
      throw new BadRequestException('Email is required')
    }

    const normalizedEmail = email.trim().toLowerCase()

    const recentOtp = await this.prisma.otpCode.findFirst({
      where: {
        email: normalizedEmail,
        isConsumed: false,
        isFailedAttempt: false,
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
    const codeHash = await bcrypt.hash(otp, 10)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    await this.prisma.otpCode.create({
      data: { email: normalizedEmail, codeHash, expiresAt },
    })

    await this.sendOtpEmail(normalizedEmail, otp)

    return { message: 'OTP sent successfully' }
  }

  // ─── Email OTP — Verify ─────────────────────────────────────────────────────

  async verifyOtp(
    email: string,
    code: string,
    userAgent?: string,
  ): Promise<AuthResponse> {
    if (!email?.trim()) {
      throw new BadRequestException('Email is required')
    }

    const normalizedEmail = email.trim().toLowerCase()

    const otpRecord = await this.prisma.otpCode.findFirst({
      where: {
        email: normalizedEmail,
        isConsumed: false,
        isFailedAttempt: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!otpRecord) {
      throw new BadRequestException('OTP not found or expired')
    }

    const failedAttempts = await this.prisma.otpCode.count({
      where: {
        email: normalizedEmail,
        isFailedAttempt: true,
        createdAt: { gt: otpRecord.createdAt },
      },
    })

    if (failedAttempts >= 5) {
      throw new BadRequestException(
        'Too many incorrect attempts. Request a new OTP.',
      )
    }

    const valid = await bcrypt.compare(code, otpRecord.codeHash)
    if (!valid) {
      await this.prisma.otpCode.create({
        data: {
          email: normalizedEmail,
          codeHash: '',
          expiresAt: otpRecord.expiresAt,
          isFailedAttempt: true,
        },
      })
      throw new BadRequestException('Invalid OTP')
    }

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

    await this.prisma.otpCode.create({
      data: {
        email: normalizedEmail,
        codeHash: '',
        expiresAt: otpRecord.expiresAt,
        isConsumed: true,
        userId: user.id,
      },
    })

    const tokens = await this.issueTokenPair(user, userAgent)
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
        userAgent: opts.userAgent,
      },
    })
  }

  // ─── Onboarding ─────────────────────────────────────────────────────────────

  async completeOnboarding(
    userId: string,
    dto: { name: string; age?: number },
  ): Promise<{ message: string }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        age: dto.age ?? null,
        onboardingCompleted: true,
        role: UserRole.REGISTERED_USER,
      },
    })
    return { message: 'Onboarding completed' }
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
