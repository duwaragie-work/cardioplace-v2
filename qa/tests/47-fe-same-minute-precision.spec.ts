import { expect, test } from '@playwright/test'
import { authedApi, signInPatient } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Bug 15 — `<input type="time">` is minute-only, so the FE form built measuredAt
 * at MINUTE precision (`...T15:11:00.000Z`). Two readings in the same wall-clock
 * minute then produced identical measuredAt strings and the second hit the DB
 * `@@unique([userId, measuredAt])` → 409 Conflict. No prior spec drove the FE
 * FORM at all (every helper posts via `Date.now()` ms precision), so this was a
 * pure API-test blind spot.
 *
 * The fix sends real now() (full ms) for "just now" submissions. This spec is
 * the regression guard: it drives the real check-in wizard and asserts the
 * persisted measuredAt carries SUB-MINUTE precision. A minute-truncated value
 * always lands on `:00.000`; the fix never does — so two same-minute submits can
 * no longer collide. (The pure two-branch logic + the collision-display rule are
 * covered deterministically by measuredAt.test.ts + readingsSession.test.ts.)
 */

// Drive the patient check-in wizard once to submit a reading. Dismisses any
// pre-wizard prompt (resume-draft / open-session) that appears asynchronously.
async function submitReadingViaForm(
  page: import('@playwright/test').Page,
  reading: { systolic: number; diastolic: number; heartRate: number },
): Promise<void> {
  await page.goto('/check-in')
  const visible = (sel: string) =>
    page.locator(byTestId(sel)).first().isVisible().catch(() => false)

  // Wait for something actionable (a prompt or the wizard's sticky CTA) — prompt
  // screens don't render the CTA, so don't block solely on it.
  await page
    .locator(
      [
        byTestId('checkin-startnew-btn'),
        byTestId(T.checkin.newSession),
        byTestId('check-in-submit'),
      ].join(', '),
    )
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => {})

  for (let step = 0; step < 16; step++) {
    if (await visible('checkin-startnew-btn')) {
      await page.locator(byTestId('checkin-startnew-btn')).click()
      await page.waitForTimeout(200)
      continue
    }
    if (await visible(T.checkin.newSession)) {
      await page.locator(byTestId(T.checkin.newSession)).click()
      await page.waitForTimeout(200)
      continue
    }
    if (await visible(T.checkin.systolic)) {
      await page.locator(byTestId(T.checkin.systolic)).fill(String(reading.systolic))
      await page.locator(byTestId(T.checkin.diastolic)).fill(String(reading.diastolic))
      await page.locator(byTestId(T.checkin.pulse)).fill(String(reading.heartRate))
      await page.locator(byTestId('check-in-position-sitting')).click().catch(() => {})
    }
    // Answer EVERY medication on file — goNext is gated until all are answered.
    const medYes = page.locator(byTestId(T.checkin.medicationYes))
    const medCount = await medYes.count().catch(() => 0)
    for (let m = 0; m < medCount; m++) {
      await medYes.nth(m).click().catch(() => {})
    }
    if (await visible(T.checkin.submit)) {
      await page.locator(byTestId(T.checkin.submit)).click()
      break
    }
    if (await visible(T.checkin.next)) {
      await page.locator(byTestId(T.checkin.next)).click()
      await page.waitForTimeout(300)
      continue
    }
    await page.waitForTimeout(300)
  }
  await page.waitForURL(/\/(dashboard|check-in)/, { timeout: 15_000 }).catch(() => {})
}

test.describe('Bug 15 — FE form measuredAt precision', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (mutates seed-patient journal entries)',
  )

  test('a reading submitted via the real check-in form persists with sub-minute precision (no minute truncation)', async ({
    page,
  }) => {
    test.setTimeout(90_000) // drives the multi-step check-in wizard
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      await submitReadingViaForm(page, { systolic: 130, diastolic: 85, heartRate: 72 })

      const list = await api.get('daily-journal')
      expect(list.status()).toBe(200)
      const entries = ((await list.json()).data ?? []) as Array<{
        id: string
        systolicBP?: number
        measuredAt: string
      }>
      const created = entries.find((e) => e.systolicBP === 130)
      expect(created, 'the form reading persisted').toBeTruthy()

      // Pre-fix, the FE truncated to the minute → measuredAt always ended in
      // `:00.000`. The fix uses real now() → seconds and/or millis are non-zero,
      // so two same-minute submissions can never produce an identical timestamp.
      const d = new Date(created!.measuredAt)
      const minuteTruncated = d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
      expect(
        minuteTruncated,
        `measuredAt ${created!.measuredAt} must NOT be minute-truncated (Bug 15)`,
      ).toBe(false)
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})
