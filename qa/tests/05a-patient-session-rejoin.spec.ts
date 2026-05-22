import { test, expect } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Cross-visit BP reading sessions. When the patient opens /check-in and a
 * non-expired session is already in progress, they're offered "add to this
 * session" (reuse its sessionId so the engine averages the readings) or "start
 * a new session". Every scenario needs seeded readings, so the whole suite is
 * gated behind RUN_WRITE_TESTS. The averaging math itself is covered by backend
 * unit tests — here we exercise the prompt + the add-to-session contract.
 */

const SEED_SESSION = '11111111-1111-4111-8111-111111111111'
const MIN = 60 * 1000

test.describe('Check-in session rejoin', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (seeds + mutates journal entries)',
  )

  test('reload mid-session → prompt appears; Join lands on BP entry and skips the checklist', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await tc.seedReadingsAtTime(u.id, [
      { measuredAt: new Date(Date.now() - 2 * MIN).toISOString(), systolicBP: 138, diastolicBP: 86, pulse: 72, sessionId: SEED_SESSION },
    ])
    await tc.dispose()

    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/check-in')

    await expect(page.locator(byTestId(T.checkin.openSessionPrompt))).toBeVisible()
    await page.locator(byTestId(T.checkin.joinSession)).click()

    // Joins → second-reading flow: BP entry visible, B1 checklist skipped.
    await expect(page.locator(byTestId(T.checkin.systolic))).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid^="checkin-checklist-"]')).toHaveCount(0)
  })

  test('Start new session → wizard begins at the checklist (B1)', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await tc.seedReadingsAtTime(u.id, [
      { measuredAt: new Date(Date.now() - 2 * MIN).toISOString(), systolicBP: 138, diastolicBP: 86, pulse: 72, sessionId: SEED_SESSION },
    ])
    await tc.dispose()

    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/check-in')

    await expect(page.locator(byTestId(T.checkin.openSessionPrompt))).toBeVisible()
    await page.locator(byTestId(T.checkin.newSession)).click()

    // Fresh session → full flow: the 8-item pre-measurement checklist renders.
    await expect(page.locator('[data-testid^="checkin-checklist-"]')).toHaveCount(8)
  })

  test('expired session (last reading older than the window) → no prompt', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await tc.seedReadingsAtTime(u.id, [
      { measuredAt: new Date(Date.now() - 40 * MIN).toISOString(), systolicBP: 138, diastolicBP: 86, pulse: 72, sessionId: SEED_SESSION },
    ])
    await tc.dispose()

    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/check-in')

    await expect(page.locator(byTestId(T.checkin.step(1)))).toBeVisible()
    await expect(page.locator(byTestId(T.checkin.openSessionPrompt))).toHaveCount(0)
  })

  test('first-ever check-in (no readings) → no prompt', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await tc.dispose()

    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/check-in')

    await expect(page.locator(byTestId(T.checkin.step(1)))).toBeVisible()
    await expect(page.locator(byTestId(T.checkin.openSessionPrompt))).toHaveCount(0)
  })

  test('AFib patient with 1 reading → prompt shows the "needs more readings" line', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await tc.setUserCondition(u.id, 'hasAFib', true)
    await tc.seedReadingsAtTime(u.id, [
      { measuredAt: new Date(Date.now() - 2 * MIN).toISOString(), systolicBP: 138, diastolicBP: 86, pulse: 72, sessionId: SEED_SESSION },
    ])
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/check-in')
      await expect(page.locator(byTestId(T.checkin.openSessionPrompt))).toBeVisible()
      await expect(page.locator(byTestId(T.checkin.openSessionNeedsMore))).toBeVisible()
    } finally {
      await tc.setUserCondition(u.id, 'hasAFib', false)
      await tc.dispose()
    }
  })
})

test.describe('active-session API + add-to-session contract', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (seeds + mutates journal entries)',
  )

  test('GET active-session returns the open session; a reading within the window keeps its sessionId', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await tc.seedReadingsAtTime(u.id, [
      { measuredAt: new Date(Date.now() - 2 * MIN).toISOString(), systolicBP: 138, diastolicBP: 86, pulse: 72, sessionId: SEED_SESSION },
    ])
    await tc.dispose()

    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)

    const activeRes = await api.get('daily-journal/active-session')
    expect(activeRes.ok()).toBeTruthy()
    const active = await activeRes.json()
    expect(active.sessionId).toBe(SEED_SESSION)
    expect(active.readingCount).toBe(1)

    // Add a second reading within the window with the same sessionId.
    const postRes = await api.post('daily-journal', {
      data: { measuredAt: new Date().toISOString(), systolicBP: 140, diastolicBP: 88, pulse: 74, sessionId: SEED_SESSION },
    })
    expect(postRes.status()).toBe(202)
    const created = (await postRes.json()).data
    expect(created.sessionId).toBe(SEED_SESSION)
    await api.dispose()
  })

  test('a reading attached to an EXPIRED sessionId is dropped to null', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    // Newest member of SEED_SESSION is 40 min ago → beyond the 30-min window.
    await tc.seedReadingsAtTime(u.id, [
      { measuredAt: new Date(Date.now() - 40 * MIN).toISOString(), systolicBP: 138, diastolicBP: 86, pulse: 72, sessionId: SEED_SESSION },
    ])
    await tc.dispose()

    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    const postRes = await api.post('daily-journal', {
      data: { measuredAt: new Date().toISOString(), systolicBP: 140, diastolicBP: 88, pulse: 74, sessionId: SEED_SESSION },
    })
    expect(postRes.status()).toBe(202)
    const created = (await postRes.json()).data
    expect(created.sessionId).toBeNull()
    await api.dispose()
  })
})
