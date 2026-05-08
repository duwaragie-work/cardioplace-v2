import type { Page, BrowserContext, APIRequestContext } from '@playwright/test'
import { expect, request as pwRequest } from '@playwright/test'
import { byTestId, T } from './selectors.js'
import { DEMO_OTP } from './accounts.js'

/**
 * Sign in via the patient frontend's UI. Uses the perma-OTP path — non-seeded
 * emails fall through to a real OTP send and will fail with `Invalid OTP`.
 *
 * Lands on `/dashboard` for fully-onboarded patients; on `/onboarding` for
 * fresh accounts. Caller asserts whichever they expect.
 */
export async function signInPatient(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in')
  // Sign-in page renders the OTP tab on demand. Click it if visible; if it's
  // already the only path, the click is a no-op via .catch.
  await page.locator(byTestId(T.signIn.otpTab)).click().catch(() => {})
  await page.locator(byTestId(T.signIn.emailInput)).fill(email)
  await page.locator(byTestId(T.signIn.sendOtpBtn)).click()
  await page.locator(byTestId(T.signIn.otpInput)).fill(DEMO_OTP)
  await page.locator(byTestId(T.signIn.verifyBtn)).click()
  // Either /dashboard (existing patient) or /onboarding (new patient) — both fine.
  await page.waitForURL(/\/(dashboard|onboarding|clinical-intake)(\?.*)?$/, { timeout: 30_000 })
}

/**
 * Sign in via the admin app. Same OTP perma-code, but the admin sign-in's
 * `appContext: 'admin'` body field gates by role on the backend.
 */
export async function signInAdmin(
  page: Page,
  email: string,
  adminBaseUrl: string,
): Promise<void> {
  await page.goto(`${adminBaseUrl}/sign-in`)
  await page.locator(byTestId(T.admin.signInEmail)).fill(email)
  await page.locator(byTestId(T.admin.signInSendOtp)).click()
  await page.locator(byTestId(T.admin.signInOtp)).fill(DEMO_OTP)
  await page.locator(byTestId(T.admin.signInVerify)).click()
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
}

/** Sign out via the patient profile page. */
export async function signOutPatient(page: Page): Promise<void> {
  await page.goto('/profile')
  await page.locator(byTestId(T.profile.signOut)).click()
  await page.waitForURL(/\/(sign-in|$)/)
}

/**
 * Headless API sign-in — mints a JWT directly via OTP without driving the
 * browser. Used by API-level helpers (test-control resets, escalation drivers)
 * that don't need a real session cookie.
 *
 * Returns the access token. The token is short-lived (~15 min) so callers
 * should reuse it within the test, not cache across tests.
 */
export async function apiSignIn(
  apiBase: string,
  email: string,
  appContext: 'patient' | 'admin' = 'patient',
): Promise<{ accessToken: string; userId: string; ctx: APIRequestContext }> {
  // Backend mounts /api globally — strip if caller already included it,
  // then re-prefix here so callers can stay agnostic.
  const root = apiBase.replace(/\/api\/?$/, '').replace(/\/$/, '')
  const deviceId = `qa-${email}-device`
  const ctx = await pwRequest.newContext({
    baseURL: root,
    extraHTTPHeaders: { 'x-device-id': deviceId },
  })
  const sendRes = await ctx.post('/api/v2/auth/otp/send', {
    data: { email, appContext, deviceId },
  })
  expect(sendRes.ok(), `OTP send failed: ${sendRes.status()}: ${await sendRes.text()}`).toBeTruthy()

  const verifyRes = await ctx.post('/api/v2/auth/otp/verify', {
    data: { email, otp: DEMO_OTP, appContext, deviceId },
  })
  expect(verifyRes.ok(), `OTP verify failed: ${verifyRes.status()}: ${await verifyRes.text()}`).toBeTruthy()

  const body = await verifyRes.json()
  const accessToken = body?.accessToken ?? body?.access_token
  const userId = body?.user?.id ?? body?.userId
  if (!accessToken) {
    throw new Error(`apiSignIn: no accessToken in response: ${JSON.stringify(body)}`)
  }
  return { accessToken, userId, ctx }
}

/**
 * Build an authenticated APIRequestContext that sends the bearer token on
 * every request. baseURL includes the /api prefix so helpers can call
 * `/daily-journal`, `/admin/...`, `/me/...` without re-prefixing.
 */
export async function authedApi(
  apiBase: string,
  email: string,
  appContext: 'patient' | 'admin' = 'patient',
): Promise<APIRequestContext> {
  const { accessToken } = await apiSignIn(apiBase, email, appContext)
  const root = apiBase.replace(/\/api\/?$/, '').replace(/\/$/, '')
  return pwRequest.newContext({
    baseURL: `${root}/api/`,
    extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
  })
}

/** Forget any persistent storage so the next sign-in is a clean slate. */
export async function clearSession(context: BrowserContext): Promise<void> {
  await context.clearCookies()
  await context.clearPermissions()
}
