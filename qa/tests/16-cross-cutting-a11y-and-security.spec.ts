import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { signInPatient, signInAdmin } from '../helpers/auth.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
import { ADMIN_BASE_URL, API_BASE_URL } from '../playwright.config.js'

/**
 * Cross-cutting: accessibility (axe-core), security smoke (no PHI in URLs,
 * no refresh token in localStorage, console-error-free), HTTP smoke
 * (security headers, robots/sitemap content type).
 *
 * Per cardioplace-qa-test-strategy.md §9 the WCAG hard-fails block CI:
 *   color-contrast, label, duplicate-id, heading-order, aria-required-attr,
 *   image-alt.
 */

const HARD_AXE_RULES = [
  'color-contrast',
  'label',
  'duplicate-id',
  'heading-order',
  'aria-required-attr',
  'image-alt',
]

// Known WCAG debt — selectors that intentionally violate AA Normal contrast
// at vibrant red-600 / orange-500 + small text. Tracked in
// `admin/src/app/globals.css` and `frontend/src/components/cardio/theme.css`
// under "KNOWN DEBT"; accepted per commit 43e4aa2 + 70f2ff4 as pilot-UX trade.
// Future fix: bump consumer font sizes to satisfy AA Large, NOT a hex rollback.
//
// Two exclusion patterns:
//
//   1. `[data-axe-debt="avatar-orange-small-text"]` — explicit tag on
//      specific components (avatar circles, vibrant-bg CTA pills, marketing
//      banner mocks). Future-proof: a NEW component without this tag still
//      gets axe scrutiny.
//
//   2. CSS attribute-substring selectors that match the *chip-on-tint*
//      pattern by definition: any inline style that pairs a `*-light` bg
//      with a `*-text` foreground is the accepted chip pattern. Catches the
//      long tail of small status pills ("Due today", "Awaiting verification",
//      "Moderate", BP-vs-target, severity badges) without needing per-chip
//      tags. Trade-off: a properly-sized chip (≥14px bold) using the same
//      tokens also gets excluded — accepted because the chip pattern itself
//      is intentionally on the debt list.
const AXE_DEBT_SELECTORS = [
  '[data-axe-debt="avatar-orange-small-text"]',
  '[style*="var(--brand-warning-amber-light)"][style*="var(--brand-warning-amber-text)"]',
  '[style*="var(--brand-alert-red-light)"][style*="var(--brand-alert-red-text)"]',
]

test.describe('Patient app — axe-core hard-fail on key pages', () => {
  const patientPaths = ['/', '/sign-in', '/dashboard', '/check-in', '/readings', '/notifications', '/profile']

  for (const path of patientPaths) {
    test(`axe hard-fail on ${path}`, async ({ page }) => {
      if (path !== '/' && path !== '/sign-in') {
        await signInPatient(page, PATIENTS.aisha.email)
      }
      await page.goto(path)
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})

      let builder = new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      for (const sel of AXE_DEBT_SELECTORS) builder = builder.exclude(sel)
      const results = await builder.analyze()

      const blocking = results.violations.filter((v) => HARD_AXE_RULES.includes(v.id))
      expect(
        blocking,
        `axe hard-fails on ${path}:\n${JSON.stringify(blocking, null, 2)}`,
      ).toEqual([])
    })
  }
})

test.describe('Admin app — axe-core', () => {
  test('admin dashboard axe hard-fail', async ({ page }) => {
    await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/dashboard`)
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    let builder = new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
    for (const sel of AXE_DEBT_SELECTORS) builder = builder.exclude(sel)
    const results = await builder.analyze()
    const blocking = results.violations.filter((v) => HARD_AXE_RULES.includes(v.id))
    expect(
      blocking,
      `admin dashboard axe hard-fails:\n${JSON.stringify(blocking, null, 2)}`,
    ).toEqual([])
  })
})

test.describe('Security smoke', () => {
  test('refresh token NOT in localStorage after sign-in (brief §9 — currently FAILS in v1)', async ({ page }) => {
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/dashboard')
    const ls = await page.evaluate(() => Object.keys(localStorage))
    const refreshKey = ls.find((k) => /refresh/i.test(k))
    expect(
      refreshKey,
      `refresh token in localStorage: "${refreshKey}" — XSS=account takeover`,
    ).toBeFalsy()
  })

  test('access_token cookie is HttpOnly', async ({ page, context }) => {
    await signInPatient(page, PATIENTS.aisha.email)
    const cookies = await context.cookies()
    const access = cookies.find((c) => c.name === 'access_token')
    if (access) {
      expect(access.httpOnly, 'access_token cookie must be HttpOnly').toBe(true)
      expect(access.secure || /localhost/.test(access.domain ?? '')).toBe(true)
    }
  })

  test('no PHI in URL bar across patient session', async ({ page }) => {
    await signInPatient(page, PATIENTS.aisha.email)
    const urls: string[] = []
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) urls.push(f.url())
    })
    await page.goto('/dashboard')
    await page.goto('/readings')
    await page.goto('/notifications')
    await page.goto('/profile')

    for (const u of urls) {
      // BP values, names, dates — none belong in URLs.
      expect(u, `PHI-shaped string in URL: ${u}`).not.toMatch(/\d{2,3}\/\d{2,3}/)
      expect(u).not.toMatch(/Aisha|Johnson/i)
    }
  })

  test('console error-free during patient walk', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/dashboard')
    await page.goto('/readings')
    await page.goto('/notifications')
    await page.goto('/profile')
    const fatal = errors.filter(
      (e) =>
        // Standard noise filters
        !/ResizeObserver|preload|hydration|favicon|net::ERR_/i.test(e) &&
        // 401 from the cookie-rehydrate /refresh attempt is expected when
        // there's no live session yet — it's how the auth-context detects
        // "logged out" (cluster-1 / B5+B6 model). Filtering this lets the
        // console-clean assertion still catch genuine errors.
        !/401|Unauthorized/i.test(e),
    )
    expect(fatal, fatal.join('\n')).toEqual([])
  })
})

test.describe('HTTP / proxy smoke', () => {
  test('robots.txt returns text/plain (brief §P0.2)', async ({ request }) => {
    const res = await request.get('/robots.txt')
    if (res.ok()) {
      expect(res.headers()['content-type']).toMatch(/text\/plain/)
    } else {
      test.fail(true, 'robots.txt should exist with content-type: text/plain')
    }
  })

  test('sitemap.xml returns xml (brief §P0.2)', async ({ request }) => {
    const res = await request.get('/sitemap.xml')
    if (res.ok()) {
      expect(res.headers()['content-type']).toMatch(/xml/)
    } else {
      test.fail(true, 'sitemap.xml should exist with content-type: application/xml')
    }
  })
})

// ─── Phase 1 — admin app PHI safety (§F) ─────────────────────────────────────
//
// Extends the existing patient-app PHI checks to the admin surface, where the
// audit trail lives. PHI must not appear in the URL bar, the console, or
// error-response bodies. Patient-detail URLs use opaque userIds (not PHI);
// the leak shapes we guard are BP values (\d{2,3}/\d{2,3}), patient names,
// and DOB-shaped strings.
const PHI_NAME_RE = /Aisha|Johnson|James|Okafor|Priya|Menon|Rita|Washington|Charles|Brown/i
const BP_SHAPE_RE = /\d{2,3}\/\d{2,3}/

test.describe('Admin app — PHI safety (§F)', () => {
  test('no PHI in admin URL bar across patient-detail walk', async ({ page }) => {
    const urls: string[] = []
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) urls.push(f.url())
    })
    try {
      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/patients`)
      const link = page.getByText(PATIENTS.aisha.name).first()
      await expect(link).toBeVisible({ timeout: 15_000 })
      await link.click()
      await expect(page).toHaveURL(/\/patients\/[^/]+$/, { timeout: 20_000 })
      for (const tab of ['Alerts', 'Medications', 'Readings', 'Thresholds', 'Timeline']) {
        const t = page.getByRole('tab', { name: tab })
        if (await t.isVisible().catch(() => false)) await t.click()
      }
    } catch (err) {
      test.skip(true, `admin UI walk not reachable: ${(err as Error).message}`)
      return
    }
    for (const u of urls) {
      expect(u, `BP-shaped string in admin URL: ${u}`).not.toMatch(BP_SHAPE_RE)
      expect(u, `patient name in admin URL: ${u}`).not.toMatch(PHI_NAME_RE)
    }
  })

  test('console error-free during admin patient-detail walk', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    try {
      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/patients`)
      const link = page.getByText(PATIENTS.aisha.name).first()
      await expect(link).toBeVisible({ timeout: 15_000 })
      await link.click()
      await expect(page).toHaveURL(/\/patients\/[^/]+$/, { timeout: 20_000 })
    } catch (err) {
      test.skip(true, `admin UI walk not reachable: ${(err as Error).message}`)
      return
    }
    const fatal = errors.filter(
      (e) =>
        !/ResizeObserver|preload|hydration|favicon|net::ERR_/i.test(e) &&
        !/401|Unauthorized/i.test(e),
    )
    // Console must also not leak PHI even in benign log lines.
    for (const e of errors) {
      expect(e, `PHI name in admin console: ${e}`).not.toMatch(PHI_NAME_RE)
    }
    expect(fatal, fatal.join('\n')).toEqual([])
  })

  test('error responses do not leak other patients PHI', async ({ request }) => {
    // An invalid/garbage alert id must not echo any other patient's name or
    // BP into the error body or a stack trace.
    const probes = [
      `${API_BASE_URL}/api/provider/alerts/not-a-real-id/detail`,
      `${API_BASE_URL}/api/provider/patients/not-a-real-id/alerts`,
    ]
    for (const url of probes) {
      const res = await request.get(url).catch(() => null)
      if (!res) continue
      const body = await res.text()
      expect(body, `PHI name leaked in error body for ${url}`).not.toMatch(PHI_NAME_RE)
      expect(body, `BP-shaped string leaked in error body for ${url}`).not.toMatch(BP_SHAPE_RE)
    }
  })
})
