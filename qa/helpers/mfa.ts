import type { Page, CDPSession } from '@playwright/test'
import { expect } from '@playwright/test'
import { authenticator } from 'otplib'
import { byTestId, T } from './selectors.js'
import { authedApi } from './auth.js'
import { DEMO_OTP } from './accounts.js'

/**
 * MFA test helpers (phase/27 — Manisha 2026-06-12 Access Control §6).
 *
 *   • Admin  = TOTP authenticator app + one-time recovery codes.
 *   • Patient = WebAuthn (Face ID / fingerprint) + one-time recovery codes.
 *
 * Two hard parts this file encapsulates:
 *   1. Generating valid TOTP codes — we use the SAME `otplib` the backend's
 *      MfaService uses (RFC 6238 defaults: 6 digits, 30s step, SHA-1), so a
 *      code minted here verifies server-side. The enrollment secret rides back
 *      in the otpauth:// provisioning URI, which we parse.
 *   2. Driving WebAuthn without a real biometric — Chromium's CDP virtual
 *      authenticator (`WebAuthn.addVirtualAuthenticator`) auto-answers the
 *      register/authenticate ceremonies with user-verification pre-satisfied.
 *      Chromium-only: patient biometric specs skip on firefox/webkit.
 */

// ─── TOTP ───────────────────────────────────────────────────────────────────

/** Pull the base32 secret out of an otpauth:// provisioning URI. */
export function extractTotpSecret(provisioningUri: string): string {
  const secret = new URL(provisioningUri).searchParams.get('secret')
  if (!secret) {
    throw new Error(`No secret in provisioning URI: ${provisioningUri}`)
  }
  return secret
}

/** Current 6-digit TOTP code for a base32 secret (matches the backend). */
export function totpCode(secret: string): string {
  return authenticator.generate(secret)
}

/**
 * Enroll a provider/admin in TOTP via the authenticated API (no UI), returning
 * the base32 secret (to mint challenge codes) + the one-time recovery codes.
 *
 * Precondition: the account must NOT already be MFA-enrolled — otherwise the
 * OTP sign-in inside `authedApi` comes back as MFA_REQUIRED (no token) and
 * throws. Call `tc.resetUserMfa(userId)` first.
 */
export async function enrollAdminTotp(
  apiBase: string,
  email: string,
): Promise<{ secret: string; recoveryCodes: string[] }> {
  const api = await authedApi(apiBase, email, 'admin')
  try {
    const startRes = await api.post('v2/auth/mfa/enroll/start', { data: {} })
    expect(
      startRes.ok(),
      `mfa/enroll/start failed: ${startRes.status()} ${await startRes.text()}`,
    ).toBeTruthy()
    const { provisioningUri, enrollmentToken } = (await startRes.json()) as {
      provisioningUri: string
      enrollmentToken: string
    }
    const secret = extractTotpSecret(provisioningUri)

    const completeRes = await api.post('v2/auth/mfa/enroll/complete', {
      data: { enrollmentToken, code: totpCode(secret) },
    })
    expect(
      completeRes.ok(),
      `mfa/enroll/complete failed: ${completeRes.status()} ${await completeRes.text()}`,
    ).toBeTruthy()
    const { recoveryCodes } = (await completeRes.json()) as {
      recoveryCodes: string[]
    }
    return { secret, recoveryCodes }
  } finally {
    await api.dispose()
  }
}

// ─── WebAuthn virtual authenticator (Chromium / CDP) ──────────────────────────

export interface VirtualAuthenticator {
  client: CDPSession
  authenticatorId: string
  /** Remove the authenticator + detach the CDP session. Safe to double-call. */
  remove(): Promise<void>
}

/**
 * Attach a CTAP2 platform virtual authenticator to this page's target with
 * user-verification pre-satisfied, so register/authenticate ceremonies resolve
 * automatically. Bound to the page target — survives navigations/reloads on the
 * same `page`, absent on any other page/context (which is what the recovery-
 * fallback spec relies on to force a ceremony failure).
 */
export async function addVirtualAuthenticator(
  page: Page,
): Promise<VirtualAuthenticator> {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  const { authenticatorId } = await client.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  )
  return {
    client,
    authenticatorId,
    async remove() {
      try {
        await client.send('WebAuthn.removeVirtualAuthenticator', {
          authenticatorId,
        })
      } catch {
        /* already gone */
      }
      try {
        await client.detach()
      } catch {
        /* already detached */
      }
    },
  }
}

// ─── Sign-in helpers that EXPECT a second-factor challenge ────────────────────

/**
 * Drive the admin OTP first factor for an MFA-enrolled account and land on the
 * TOTP challenge page. Handles the multi-practice selector that, for those
 * accounts, runs BEFORE the MFA challenge.
 */
export async function adminOtpExpectingMfaChallenge(
  page: Page,
  email: string,
  adminBaseUrl: string,
  practiceName?: string,
): Promise<void> {
  await page.goto(`${adminBaseUrl}/sign-in`)
  await page.locator(byTestId(T.admin.signInEmail)).fill(email)
  await page.locator(byTestId(T.admin.signInSendOtp)).click()
  await page.locator(byTestId(T.admin.signInOtp)).fill(DEMO_OTP)
  await page.locator(byTestId(T.admin.signInVerify)).click()
  await page.waitForURL(
    (url) =>
      /\/sign-in\/mfa-challenge/.test(url.pathname) ||
      /\/sign-in\/select-practice/.test(url.pathname),
    { timeout: 30_000 },
  )
  if (/\/sign-in\/select-practice/.test(new URL(page.url()).pathname)) {
    const option = practiceName
      ? page.locator('main ul li button', { hasText: practiceName })
      : page.locator('main ul li button')
    await option.first().click()
    await page.waitForURL(/\/sign-in\/mfa-challenge/, { timeout: 30_000 })
  }
}

/**
 * Drive the patient OTP first factor for an account with a registered biometric
 * and land on the /sign-in/biometric page. Uses OTP (not magic-link) because
 * only the OTP-verify path carries the WEBAUTHN_REQUIRED handoff.
 */
export async function patientOtpExpectingBiometric(
  page: Page,
  email: string,
): Promise<void> {
  await page.goto('/sign-in')
  await page.locator(byTestId(T.signIn.otpTab)).click().catch(() => {})
  await page.locator(byTestId(T.signIn.emailInput)).fill(email)
  await page.locator(byTestId(T.signIn.sendOtpBtn)).click()
  await page.locator(byTestId(T.signIn.otpInput)).fill(DEMO_OTP)
  await page.locator(byTestId(T.signIn.verifyBtn)).click()
  await page.waitForURL(/\/sign-in\/biometric/, { timeout: 30_000 })
}
