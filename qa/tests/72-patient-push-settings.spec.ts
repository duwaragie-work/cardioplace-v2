import { test, expect, type Page } from '@playwright/test'
import { signInPatient } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Spec 72 — patient push-notification Settings toggle.
 *
 * Real Web Push (service worker + VAPID + OS delivery) can't run in headless
 * CI, so we stub the browser push APIs + the /push endpoints and assert the
 * TOGGLE LOGIC the app owns:
 *   - enable  → On (subscribe)
 *   - disable → Off (unsubscribe) + a per-device opt-out is persisted
 *   - the regression that prompted this: Off STAYS Off across a reload, instead
 *     of auto-registration silently re-subscribing.
 *
 * Chromium-only: push APIs are most consistent there, and the default PR matrix
 * is chromium-desktop.
 */

// Any valid base64url string works — the stubbed subscribe ignores it.
const VAPID_PUBLIC_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8'

const OPTOUT_KEY = 'cp_push_optout'

/** Drive the card to the On state, tolerant of the auto-registration race that
 *  may have already subscribed on sign-in. */
async function ensureOn(page: Page): Promise<void> {
  const enable = page.locator(byTestId(T.notif.enable))
  const disable = page.locator(byTestId(T.notif.disable))
  await expect(enable.or(disable)).toBeVisible({ timeout: 15_000 })
  if (await enable.isVisible()) await enable.click()
  await expect(disable).toBeVisible({ timeout: 15_000 })
}

test.describe('Spec 72 — patient push notification settings', () => {
  test.beforeEach(async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'push APIs are stubbed for chromium only')

    await context.grantPermissions(['notifications'])

    // Deterministic push ceremony: replace the service worker + push manager
    // with an in-memory fake so enable/disable resolve without a real push
    // service. Re-injected on every navigation (incl. the app's full reloads).
    //
    // push.service.ts:13 `supported()` gates on the presence of three globals
    // in the page context: `'serviceWorker' in navigator`, `'PushManager' in
    // window`, `'Notification' in window`. Headless Chromium at localhost does
    // expose Notification but does NOT always expose PushManager — with only
    // navigator.serviceWorker stubbed, supported() returned false, the
    // NotificationSettings component fell through to the "Unsupported" info
    // banner, and neither the enable nor disable data-testid ever rendered.
    // Stub PushManager on the window (as a plain constructor stand-in) so the
    // `in` check passes and the toggle actually mounts.
    await page.addInitScript(() => {
      let current: unknown = null
      const fakeSub = {
        endpoint: 'https://push.example.test/fake-endpoint',
        toJSON: () => ({
          endpoint: 'https://push.example.test/fake-endpoint',
          keys: { p256dh: 'fake-p256dh', auth: 'fake-auth' },
        }),
        unsubscribe: async () => {
          current = null
          return true
        },
      }
      const fakeReg = {
        pushManager: {
          getSubscription: async () => current,
          subscribe: async () => {
            current = fakeSub
            return fakeSub
          },
        },
      }
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          register: async () => fakeReg,
          getRegistration: async () => fakeReg,
          ready: Promise.resolve(fakeReg),
        },
      })
      // Stand-in for the missing PushManager global so `'PushManager' in
      // window` returns true. push.service.ts never news-up this class —
      // the real ceremony goes through the ServiceWorkerRegistration mock
      // above — so an empty constructor is enough for the `in` check.
      if (!('PushManager' in window)) {
        Object.defineProperty(window, 'PushManager', {
          configurable: true,
          value: function PushManager() {},
        })
      }
    })

    // Stub the push API so no real backend rows are touched.
    await page.route('**/api/v2/push/vapid-public-key', (route) =>
      route.fulfill({ json: { publicKey: VAPID_PUBLIC_KEY } }),
    )
    await page.route('**/api/v2/push/subscribe', (route) =>
      route.fulfill({ json: { ok: true } }),
    )
    await page.route('**/api/v2/push/unsubscribe', (route) =>
      route.fulfill({ json: { ok: true } }),
    )

    await signInPatient(page, PATIENTS.aisha.email)
  })

  test('enable → On, disable → Off, and Off survives a reload', async ({ page }) => {
    await page.goto('/settings')

    const enable = page.locator(byTestId(T.notif.enable))
    const disable = page.locator(byTestId(T.notif.disable))

    // Turn it on (or confirm auto-registration already did).
    await ensureOn(page)

    // Turn it off → the enable button returns…
    await disable.click()
    await expect(enable).toBeVisible({ timeout: 15_000 })

    // …and the per-device opt-out is persisted (the mechanism behind the fix).
    const optout = await page.evaluate((k) => localStorage.getItem(k), OPTOUT_KEY)
    expect(optout).toBe('1')

    // Regression: a reload must NOT silently re-enable. Without the opt-out,
    // auto-registration flipped it back On after every navigation/reload.
    await page.reload()
    await expect(enable).toBeVisible({ timeout: 15_000 })
    await expect(disable).toHaveCount(0)
  })
})
