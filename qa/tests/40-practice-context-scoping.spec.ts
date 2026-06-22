import { test, expect } from '@playwright/test'
import { ADMIN_BASE_URL, API_BASE_URL } from '../playwright.config.js'
import { ADMINS, DEMO_OTP, PATIENTS } from '../helpers/accounts.js'

/**
 * PR #90 Bug B — strict practice-context scoping (Duwaragie 2026-06-19).
 *
 * A multi-practice provider must see ONLY the patients of the practice they
 * are acting as. Pre-fix, `patientScopeFilter()` returned the UNION of all
 * the provider's practices regardless of `activePracticeId`, so switching the
 * chip changed the label but not the visible patient list.
 *
 * Seed reality (backend/prisma/seed/patients.ts): every seed patient is
 * assigned to `seed-cedar-hill`. NO patient is assigned to `seed-bridgepoint`.
 * So acting-as-Cedar-Hill shows the full patient list; acting-as-BridgePoint
 * shows the empty state — a clean, deterministic scoping assertion.
 *
 * Also exercises PR #90 Bug A — the chip must render "Acting as: <real name>"
 * on the fresh sign-in window, never the "Acting as: Acting as practice"
 * placeholder. The fix populates availablePractices on login() and resolves
 * the practice name in the /select-practice + /switch-practice responses.
 *
 * Drives sign-in via the HTTP API + cookie planting (same approach as spec
 * 37) because the verify → selector → select-practice UI flow flake-detaches
 * buttons mid-hydration. The API sets the same HttpOnly cookies the browser
 * would, so /patients loads with a fully-warm session carrying the chosen
 * activePracticeId JWT claim — exactly the scenario we need to scope.
 *
 * Gated on SEED_TEST_FIXTURES=true (the multi-practice provider + Practice B
 * only exist under that flag).
 */

const SEED_FIXTURES_ENABLED = process.env.SEED_TEST_FIXTURES === 'true'

const CEDAR_HILL_ID = 'seed-cedar-hill'
const BRIDGEPOINT_ID = 'seed-bridgepoint'

async function adminSignInViaApi(
  email: string,
  options: { practiceId?: string } = {},
): Promise<{ access: string; refresh: string }> {
  const deviceId = `spec40-${email.replace(/[^a-z0-9]/g, '-')}-${Date.now()}`
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

// Wait until the patient list has resolved into either rows or the empty
// state — never assert a count while the list is still loading.
async function waitForPatientListSettled(page: {
  waitForSelector: (sel: string, opts?: Record<string, unknown>) => Promise<unknown>
}) {
  await page.waitForSelector(
    '[data-testid^="admin-patient-list-row-"], [data-testid="admin-patient-list-empty"]',
    { timeout: 30_000 },
  )
}

test.describe('PR #90 — strict practice-context scoping + chip name', () => {
  test.skip(
    !SEED_FIXTURES_ENABLED,
    'requires SEED_TEST_FIXTURES=true for the multi-practice fixture',
  )

  test('acting as Cedar Hill → sees Cedar Hill patients + chip shows the real name (Bug A + Bug B)', async ({
    context,
    page,
  }) => {
    const tokens = await adminSignInViaApi(ADMINS.multiPracticeProvider.email, {
      practiceId: CEDAR_HILL_ID,
    })
    await setAuthCookies(context, tokens, 'PROVIDER')

    await page.goto(`${ADMIN_BASE_URL}/patients`)
    await page.waitForURL(/\/patients/, { timeout: 30_000 })
    await waitForPatientListSettled(page)

    // Bug B — Cedar Hill has the full seed patient roster.
    const rows = page.locator('[data-testid^="admin-patient-list-row-"]')
    expect(await rows.count()).toBeGreaterThan(0)
    await expect(
      page.locator('[data-testid="admin-patient-list-empty"]'),
    ).toHaveCount(0)
    // A known Cedar-Hill-assigned seed patient is present.
    await expect(page.getByText(PATIENTS.priya.name).first()).toBeVisible()

    // Bug A — the chip resolves the real practice name, never the placeholder.
    await expect(
      page.getByRole('button', { name: /acting as: cedar hill/i }),
    ).toBeVisible()
    await expect(page.getByText(/acting as: acting as practice/i)).toHaveCount(0)
    await expect(page.getByText(/^acting as practice$/i)).toHaveCount(0)
  })

  test('acting as BridgePoint → sees ONLY BridgePoint patients (none) — Cedar Hill roster is hidden (Bug B)', async ({
    context,
    page,
  }) => {
    const tokens = await adminSignInViaApi(ADMINS.multiPracticeProvider.email, {
      practiceId: BRIDGEPOINT_ID,
    })
    await setAuthCookies(context, tokens, 'PROVIDER')

    await page.goto(`${ADMIN_BASE_URL}/patients`)
    await page.waitForURL(/\/patients/, { timeout: 30_000 })
    await waitForPatientListSettled(page)

    // Strict scoping: no seed patient is assigned to BridgePoint, so the
    // list is empty — the Cedar Hill roster must NOT leak through.
    await expect(
      page.locator('[data-testid="admin-patient-list-empty"]'),
    ).toBeVisible()
    await expect(
      page.locator('[data-testid^="admin-patient-list-row-"]'),
    ).toHaveCount(0)
    await expect(page.getByText(PATIENTS.priya.name)).toHaveCount(0)

    // Chip reflects the active practice (Bug A — real name, not placeholder).
    await expect(
      page.getByRole('button', { name: /acting as: bridgepoint/i }),
    ).toBeVisible()
    await expect(page.getByText(/acting as: acting as practice/i)).toHaveCount(0)
  })
})
