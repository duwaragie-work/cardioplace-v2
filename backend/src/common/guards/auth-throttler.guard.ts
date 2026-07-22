import { ExecutionContext, Injectable } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'

/**
 * V-03 (Humaira assessment 2026-07-14, CRITICAL) — auth rate limiting.
 *
 * `ThrottlerModule.forRoot([{name:'default'…},{name:'otp'…}])` has been
 * configured in app.module.ts since day one, but no guard ever consumed it and
 * no route ever named a limiter: the config was inert. Unauthenticated
 * attackers could brute-force a 6-digit OTP (10^6 space) or flood otp/send with
 * nothing slowing them down.
 *
 * WHY A SUBCLASS. The stock guard keys on `req.ip` alone, which is too coarse
 * here — one NAT'd clinic would rate-limit its own staff collectively, while an
 * attacker rotating IPs against one account would sail past. Keying on
 * `ip:email` scopes a bucket to "this client attacking this account", which is
 * the unit of abuse we care about.
 *
 * WHY MOUNTED ON AuthController, NOT AS A GLOBAL APP_GUARD. The assessment
 * suggests APP_GUARD, but ThrottlerGuard.canActivate loops every configured
 * throttler for every route it guards, so a global mount applies the limit
 * app-wide. At the configured 20/60s that trips on ordinary use: one dashboard
 * navigation fans out to several API calls, so a couple of page loads inside a
 * minute would 429 a legitimate clinician mid-shift. V-03's scope is
 * "authentication endpoints have no rate limiting" — this is mounted exactly
 * there, which closes the finding with no blast radius on the clinical paths.
 * (The notifications bell polls at 30s / 2 rpm and was never the constraint.)
 *
 * ⚠️ DEPENDS ON `trust proxy` (main.ts, TRUST_PROXY_HOPS). Unset behind a load
 * balancer, `req.ip` is the LB's address for everyone: this degrades to one
 * shared bucket per email — noisy and over-strict, but NOT a bypass. Set too
 * high, `req.ip` becomes attacker-controlled and the limiter IS bypassable.
 * See the comment in main.ts.
 *
 * ⚠️ STORAGE IS PER-INSTANCE. The module uses @nestjs/throttler's default
 * in-memory Map, so N app instances give an effective N× limit and counters
 * reset on deploy. This is coarse burst control, not an account lockout — the
 * durable, multi-instance-safe per-account guarantees live in the DB
 * (OtpCode.attempts, the AuthLog-derived MFA + OTP lockouts). Moving to shared
 * storage requires restructuring app.module's ARRAY config into the object form
 * `{ throttlers: [...], storage }` — the array form ignores `storage` entirely.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  /**
   * Test-only escape hatch. The e2e suite (backend/test/auth-otp.e2e-spec.ts)
   * loops auth endpoints deliberately — e.g. 5 rapid otp/verify calls to prove
   * the OtpCode lockout — and those buckets are keyed ip:email, so a shared
   * test email on one host accumulates across tests within the 60s window and
   * would 429 mid-suite. That is the limiter working, not a bug, so the suite
   * needs to opt out rather than the limiter being loosened.
   *
   * DOUBLE-GATED, mirroring V-05's CHAT_VOICE_DEBUG_PHI: the flag is ignored
   * outright when NODE_ENV === 'production', so a stray env var cannot switch
   * off auth rate limiting in prod. A flag that can be set in prod is not a
   * control.
   */
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (
      process.env.NODE_ENV !== 'production' &&
      process.env.AUTH_THROTTLE_DISABLED === '1'
    ) {
      return true
    }
    return super.shouldSkip(context)
  }

  /**
   * Bucket key: `<ip>:<normalized email>`, falling back to IP-only.
   *
   * The email is trimmed + lowercased to match `auth.service.ts`'s
   * `email.trim().toLowerCase()` (:2867, :2991, :3412). Without that, `A@x.com`
   * and `a@x.com` would occupy different buckets while resolving to the same
   * account — a trivial bypass by varying case.
   *
   * IP-only is correct for the routes that carry no email: `mfa/challenge`
   * (challenge token), `refresh` (cookie), `webauthn/authenticate/*`.
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const ip: string = req?.ip ?? 'unknown-ip'
    const rawEmail: unknown = req?.body?.email
    if (typeof rawEmail !== 'string' || rawEmail.trim() === '') return ip
    return `${ip}:${rawEmail.trim().toLowerCase()}`
  }
}
