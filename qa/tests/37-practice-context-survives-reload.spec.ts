import { test, expect } from '@playwright/test'
import { ADMIN_BASE_URL, API_BASE_URL } from '../playwright.config.js'
import { ADMINS, DEMO_OTP } from '../helpers/accounts.js'

/**
 * Phase/practice-identity rehydrate regression (smoke 2026-06-18).
 *
 * Pre-fix `admin/src/lib/auth-context.tsx` `rehydrate()` set `user` from
 * `/auth/profile` but never restored `activePractice`. The
 * `ZeroPracticeModal` triggers on `!activePractice && isPracticeBound &&
 * !isOrgWide` — so every PROVIDER / MED_DIR / COORDINATOR was blocked by
 * the modal after the first F5 even though their AuthSession + JWT still
 * carried the right `activePracticeId`. Sign-out / sign-in was the only
 * unstick — a pilot-day-one UX disaster.
 *
 * Fix shape: `/auth/profile` now returns `activePracticeId` +
 * `activePractice` + `availablePractices` (sourced from the dual-relation
 * probe — PracticeProvider for PROVIDER/MED_DIR, PracticeCoordinator for
 * COORDINATOR, mirroring the COORDINATOR fix in commit `ba522f3`).
 * `rehydrate()` calls `setActivePractice` + `setAvailablePractices` from
 * the response.
 *
 * Drives sign-in via the HTTP API (and plants the resulting tokens as
 * cookies on the BrowserContext) rather than the UI form because the
 * verify → selector → select-practice flow involves a sessionStorage hop +
 * a Next.js router.push that flake-detaches buttons mid-hydration in
 * the test environment. The API sets the same HttpOnly cookies; the
 * browser then loads `/dashboard` with a fully-warm session, which is
 * precisely the F5 scenario we need to exercise.
 *
 * Gated on `SEED_TEST_FIXTURES=true` (matches specs 34/35/36).
 */

const SEED_FIXTURES_ENABLED = process.env.SEED_TEST_FIXTURES === 'true'

async function adminSignInViaApi(
  email: string,
  options: { practiceId?: string } = {},
): Promise<{ access: string; refresh: string }> {
  const deviceId = `spec37-${email.replace(/[^a-z0-9]/g, '-')}-${Date.now()}`
  const headers = {
    'content-type': 'application/json',
    origin: ADMIN_BASE_URL,
    'x-device-id': deviceId,
  }

  await fetch(`${API_BASE_URL}/api/v2/auth/otp/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, appContext: 'admin' }),
  })
  const verifyRes = await fetch(`${API_BASE_URL}/api/v2/auth/otp/verify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, otp: DEMO_OTP, deviceId, appContext: 'admin' }),
  })
  const verifyBody = await verifyRes.json()

  let access: string | undefined
  let refresh: string | undefined

  if (verifyBody?.status === 'PRACTICE_SELECT_REQUIRED') {
    if (!options.practiceId) {
      throw new Error(
        `verify returned PRACTICE_SELECT_REQUIRED but no practiceId supplied`,
      )
    }
    const selectRes = await fetch(`${API_BASE_URL}/api/v2/auth/select-practice`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        challengeToken: verifyBody.challengeToken,
        practiceId: options.practiceId,
      }),
    })
    const selectBody = await selectRes.json()
    access = selectBody.accessToken
    refresh = selectBody.refreshToken
  } else {
    access = verifyBody.accessToken
    refresh = verifyBody.refreshToken
  }

  if (!access || !refresh) {
    throw new Error(`no tokens in auth response: ${JSON.stringify(verifyBody)}`)
  }
  return { access, refresh }
}

const ADMIN_DOMAIN = new URL(ADMIN_BASE_URL).hostname

async function setAuthCookies(
  context: {
    addCookies: (cookies: Array<Record<string, unknown>>) => Promise<void>
  },
  tokens: { access: string; refresh: string },
  roles: string,
) {
  await context.addCookies([
    {
      name: 'cp_admin_access_token',
      value: tokens.access,
      domain: ADMIN_DOMAIN,
      path: '/',
      sameSite: 'Lax',
    },
    {
      name: 'cp_admin_refresh_token',
      value: tokens.refresh,
      domain: ADMIN_DOMAIN,
      path: '/',
      sameSite: 'Lax',
    },
    {
      name: 'cp_admin_auth_marker',
      value: '1',
      domain: ADMIN_DOMAIN,
      path: '/',
      sameSite: 'Lax',
    },
    {
      name: 'cp_admin_auth_role',
      value: encodeURIComponent(roles),
      domain: ADMIN_DOMAIN,
      path: '/',
      sameSite: 'Lax',
    },
  ])
}

test.describe('Phase/practice-identity — practice context survives page reload', () => {
  test.skip(
    !SEED_FIXTURES_ENABLED,
    'requires SEED_TEST_FIXTURES=true for multi-practice fixture',
  )

  test('multi-practice PROVIDER → after F5 the active practice is still Cedar Hill; no ZeroPracticeModal', async ({ context, page }) => {
    const tokens = await adminSignInViaApi(
      ADMINS.multiPracticeProvider.email,
      { practiceId: 'seed-cedar-hill' },
    )
    await setAuthCookies(context, tokens, 'PROVIDER')

    // First load — exercises the rehydrate path (no in-memory token,
    // restored from the access cookie + /auth/profile).
    await page.goto(`${ADMIN_BASE_URL}/dashboard`)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })

    await expect(
      page.locator('[role="alertdialog"]'),
      'first load: no ZeroPracticeModal',
    ).toHaveCount(0)
    await expect(
      page.getByText(/no practice membership/i),
      'first load: no "no practice membership" copy',
    ).toHaveCount(0)

    // The regression — F5 should NOT bounce us into the modal.
    await page.reload()
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })

    await expect(
      page.locator('[role="alertdialog"]'),
      'after F5: ZeroPracticeModal must NOT appear',
    ).toHaveCount(0)
    await expect(
      page.getByText(/no practice membership/i),
      'after F5: "no practice membership" copy must NOT appear',
    ).toHaveCount(0)
  })

  test('COORDINATOR (1:1 PracticeCoordinator) → after F5 still authed; no ZeroPracticeModal', async ({ context, page }) => {
    const tokens = await adminSignInViaApi(ADMINS.coordinator.email)
    await setAuthCookies(context, tokens, 'COORDINATOR')

    // COORDINATOR's app lands them on /users (Dashboard hidden in sidebar).
    await page.goto(`${ADMIN_BASE_URL}/users`)
    await page.waitForURL(/\/users/, { timeout: 30_000 })

    await expect(
      page.locator('[role="alertdialog"]'),
      'first load: no ZeroPracticeModal',
    ).toHaveCount(0)

    // The COORDINATOR regression: pre-fix /auth/profile didn't surface
    // their PracticeCoordinator-backed practice, so rehydrate left
    // activePractice null and ZeroPracticeModal fired on F5.
    await page.reload()
    await page.waitForURL(/\/users/, { timeout: 30_000 })

    await expect(
      page.locator('[role="alertdialog"]'),
      'after F5: ZeroPracticeModal must NOT appear for COORDINATOR',
    ).toHaveCount(0)
    await expect(
      page.getByText(/no practice membership/i),
      'after F5: "no practice membership" copy must NOT appear',
    ).toHaveCount(0)
  })
})
