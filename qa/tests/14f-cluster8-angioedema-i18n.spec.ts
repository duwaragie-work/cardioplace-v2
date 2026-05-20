import { test, expect, type Page } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { postJournalEntry, waitForAlerts } from '../helpers/api.js'
import { byTestId, T } from '../helpers/selectors.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Cluster 8 §E — angioedema i18n render tests.
 *
 * Cluster 8.1 Gap 1 (Niva, commit f0bfd78): the angioedema patient alert is
 * a Priority-1 translation. Backend persists the English string (JCAHO audit
 * record); the patient app renders it locale-aware via TierAlertView →
 * useLanguage().t('alert.angioedema.patient*'). preferredLanguage on the
 * User row drives the locale.
 *
 * §F.3 already covers the static "every angioedema key exists + is
 * translated + isn't identical to English" gate. This spec covers the
 * RUNTIME wiring: a patient whose preferredLanguage is es sees the Spanish
 * string when the /alerts/[id] page renders; am patients see Amharic.
 */

async function seedHistoryToClearPreDay3(
  tc: TestControl,
  userId: string,
): Promise<void> {
  const now = Date.now()
  const readings = Array.from({ length: 8 }).map((_, i) => ({
    measuredAt: new Date(now - (i + 1) * 24 * 60 * 60 * 1000).toISOString(),
    systolicBP: 120,
    diastolicBP: 78,
    pulse: 72,
    sessionId: crypto.randomUUID(),
  }))
  await tc.seedReadingsAtTime(userId, readings)
}

/**
 * Set Aisha's preferredLanguage via the PATCH /auth/profile endpoint. The
 * patient app's auth context reads this on sign-in + drives useLanguage().
 */
async function setPreferredLanguage(
  patientEmail: string,
  locale: 'en' | 'es' | 'am',
): Promise<void> {
  const api = await authedApi(API_BASE_URL, patientEmail)
  try {
    const res = await api.patch('auth/profile', {
      data: { preferredLanguage: locale },
    })
    expect(res.ok(), `PATCH /auth/profile failed: ${await res.text()}`).toBeTruthy()
  } finally {
    await api.dispose()
  }
}

async function setupAngioedemaAlertWithLocale(
  patientEmail: string,
  locale: 'en' | 'es' | 'am',
): Promise<{ tc: TestControl; userId: string; alertId: string }> {
  const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
  const u = await tc.findUser(patientEmail)
  await tc.resetUser(u.id)
  await seedHistoryToClearPreDay3(tc, u.id)
  await tc.setUserMedication(u.id, {
    drugName: 'Lisinopril',
    drugClass: 'ACE_INHIBITOR',
    frequency: 'ONCE_DAILY',
    verificationStatus: 'VERIFIED',
  })
  await setPreferredLanguage(patientEmail, locale)

  const api = await authedApi(API_BASE_URL, patientEmail)
  try {
    await postJournalEntry(api, {
      measuredAt: new Date().toISOString(),
      systolicBP: 124,
      diastolicBP: 78,
      pulse: 72,
      position: 'SITTING',
      faceSwelling: true,
      sessionId: crypto.randomUUID(),
    })
  } finally {
    await api.dispose()
  }
  const alerts = await waitForAlerts(tc, u.id, (xs) =>
    xs.some((a) => a.ruleId === 'RULE_ACE_ANGIOEDEMA'),
  )
  const alert = alerts.find((a) => a.ruleId === 'RULE_ACE_ANGIOEDEMA')!
  return { tc, userId: u.id, alertId: alert.id }
}

async function assertAlertMessageMatches(
  page: Page,
  alertId: string,
  textRegex: RegExp,
): Promise<void> {
  await page.goto(`/alerts/${alertId}`)
  const msg = page.locator(byTestId(T.alertDetail.messagePatient))
  await expect(msg).toBeVisible({ timeout: 20_000 })
  await expect(msg).toContainText(textRegex)
}

test.describe('Cluster 8 §E — angioedema patient alert locale-aware render', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated behind RUN_WRITE_TESTS=1')

  test('1. preferredLanguage=es → /alerts/[id] renders Spanish patient text', async ({ page }) => {
    test.setTimeout(120_000)
    const { tc, alertId } = await setupAngioedemaAlertWithLocale(PATIENTS.aisha.email, 'es')
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      // Spanish patient message includes the verbatim "no tome más" /
      // "su medicina para la presión arterial" wording from es.ts.
      await assertAlertMessageMatches(
        page,
        alertId,
        /No tome más su medicina para la presión arterial/i,
      )
    } finally {
      // Restore Aisha to en so subsequent tests / manual runs don't inherit es.
      await setPreferredLanguage(PATIENTS.aisha.email, 'en').catch(() => {})
      await tc.dispose()
    }
  })

  test('2. preferredLanguage=am → /alerts/[id] renders Amharic patient text', async ({ page }) => {
    test.setTimeout(120_000)
    const { tc, alertId } = await setupAngioedemaAlertWithLocale(PATIENTS.aisha.email, 'am')
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      // Amharic uses the Ge'ez script — assert on the unicode block presence
      // (U+1200-U+137F). Spot-check on a specific Amharic word from the
      // approved translation: "የደም ግፊት" ("blood pressure").
      await assertAlertMessageMatches(page, alertId, /የደም ግፊት/)
    } finally {
      await setPreferredLanguage(PATIENTS.aisha.email, 'en').catch(() => {})
      await tc.dispose()
    }
  })

  test('3. preferredLanguage=en (sanity baseline) → /alerts/[id] renders English text', async ({ page }) => {
    test.setTimeout(120_000)
    // Sanity guard: the en branch must still render the original approved
    // wording. A regression in the angioedemaKey wiring could fall through
    // to a chrome locale string or an empty body — guarding both.
    const { tc, alertId } = await setupAngioedemaAlertWithLocale(PATIENTS.aisha.email, 'en')
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      await assertAlertMessageMatches(
        page,
        alertId,
        /Do not take any more of your blood pressure medicine/i,
      )
    } finally {
      await tc.dispose()
    }
  })
})
