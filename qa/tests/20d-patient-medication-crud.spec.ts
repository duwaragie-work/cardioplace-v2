import { test, expect } from '@playwright/test'
import { signInPatient } from '../helpers/auth.js'
import { byTestId, T } from '../helpers/selectors.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { forceMonthlyMedReask } from '../helpers/api.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Phase 4d (§F) — medication CRUD + monthly med re-ask.
 *
 * The patient medication catalog (A5/A8/A6 cards + OtherMed modal) is the
 * same intricate multi-screen flow documented-skipped in §D 20b.4/20b.5 —
 * there are no stable per-card CRUD testids beyond the §B.4 set, so free-form
 * add / edit / delete-via-cards are not reliably drivable yet (medication
 * CRUD is covered API-side in spec 19's setUserMedication composition). The
 * monthly med re-ask card IS tractable (localStorage-driven) and is exercised
 * here end-to-end.
 */

test.describe('Phase 4d — medication CRUD + monthly re-ask (20d)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ retries: 1 })

  let tc: TestControl
  test.beforeAll(async () => {
    tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
  })
  test.afterAll(async () => {
    await tc?.dispose()
  })

  test('20d.1 — add medication via the patient app', async () => {
    test.skip(
      true,
      'Catalog-card add (A5/A8) + OtherMed free-form add have no stable CRUD ' +
        'testids beyond the §B.4 set; not reliably drivable this pass. ' +
        'Medication attach/enrichment is covered API-side (spec 19 ' +
        'setUserMedication). Follow-up: add intake med-CRUD testids.',
    )
  })

  test('20d.2 — edit dosage / frequency via the OtherMed modal', async () => {
    test.skip(
      true,
      'OtherMedEditModal flow needs dedicated edit testids (only the modal ' +
        'root + photo button were added in §B.4). Documented per the codebase ' +
        'skip convention; covered API-side in spec 19.',
    )
  })

  test('20d.3 — delete / discontinue a medication', async () => {
    test.skip(
      true,
      'Same med-catalog testid gap as 20d.1/20d.2. Discontinue audit is ' +
        'covered by the admin medication spec (11) + spec 19.',
    )
  })

  test('20d.4 — medication photo OCR upload', async () => {
    test.skip(
      !process.env.NEXT_PUBLIC_MED_OCR_ENABLED,
      'MedicationPhotoButton renders only when NEXT_PUBLIC_MED_OCR_ENABLED=true; ' +
        'OCR backend not stubbable end-to-end in this env. ' +
        'intake-medication-photo-button presence verified in §B.4.',
    )
  })

  /** Pre-seed a 31-day-stale re-ask timestamp keyed by the real userId so
   *  it is present on the component's first mount (avoids racing its
   *  mount-time "stamp now" effect that forceMonthlyMedReask loses to). */
  async function seedStaleReask(page: import('@playwright/test').Page) {
    const u = await tc.findUser(PATIENTS.aisha.email)
    const stale = Date.now() - 31 * 24 * 60 * 60 * 1000
    await page.addInitScript(
      ([uid, ts]) => {
        try {
          localStorage.setItem(`cardioplace_med_reask_at:${uid}`, String(ts))
        } catch {
          /* storage not ready — ignore */
        }
      },
      [u.id, stale] as const,
    )
  }

  test('20d.5 — monthly med re-ask card renders when localStorage is stale', async ({
    page,
  }) => {
    // Aisha has verified medications + completed intake → the re-ask card is
    // eligible once its localStorage timestamp is ≥30 days stale.
    await signInPatient(page, PATIENTS.aisha.email)
    await seedStaleReask(page)
    await page.goto('/dashboard')
    await expect(
      page.locator(byTestId(T.dashboard.monthlyMedReask)),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('20d.6 — "confirm meds unchanged" dismisses + bumps the timestamp', async ({
    page,
  }) => {
    await signInPatient(page, PATIENTS.aisha.email)
    await seedStaleReask(page)
    await page.goto('/dashboard')
    const card = page.locator(byTestId(T.dashboard.monthlyMedReask))
    await expect(card).toBeVisible({ timeout: 15_000 })
    // "Yes / still taking these" stamps now + closes the modal.
    await page
      .getByRole('button', { name: /yes|still|unchanged|confirm|same/i })
      .first()
      .click()
    await expect(card).toBeHidden({ timeout: 10_000 })
    // Timestamp bumped to ~now (not stale) → no re-prompt on reload.
    const stamp = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('cardioplace_med_reask_at:'))
          return Number(localStorage.getItem(k))
      }
      return 0
    })
    expect(stamp, 'med-reask timestamp bumped to recent').toBeGreaterThan(
      Date.now() - 5 * 60_000,
    )
    await page.reload()
    await expect(
      page.locator(byTestId(T.dashboard.monthlyMedReask)),
    ).toBeHidden({ timeout: 8_000 })
  })
})
