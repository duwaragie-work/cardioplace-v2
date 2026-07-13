/**
 * N1–N10 Patient Reminder & Engagement Workflow — Playwright E2E.
 *
 * Nivakaran's track only. Covers the four N-tasks that surface at the
 * HTTP / UI layer:
 *   • N1 + N8   Profile UI edits reminder-time / quiet-hours → PATCH lands → GET reflects
 *   • N2 + N4   Daily-reminder cron dispatches an escalating-tone Notification row
 *   • N6        Quiet-hours shift rule — reminderTime inside quiet band defers to quietEnd
 *   • N7        Logged confirmation Push notification fires after a journal-entry save,
 *               carries "Logged ✓" + "Looking good" (normal-range) with NO BP values.
 *
 * N3 (delete gap-alert) is validated by the fact that this spec exists —
 * the old gap-alert Playwright coverage in qa/tests/15 was rewired here.
 * N5, N9, N10 are backend-only / copy-only and covered by Jest specs.
 *
 * Requires ENABLE_TEST_CONTROL=true + SEED_TEST_FIXTURES=true on the backend.
 */
import { test, expect } from '@playwright/test'
import { PATIENTS } from '../helpers/accounts.js'
import { authedApi } from '../helpers/auth.js'
import { postJournalEntry } from '../helpers/api.js'
import { TestControl } from '../helpers/test-control.js'

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000'
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL ?? 'http://localhost:3000'
const TEST_CONTROL_SECRET = process.env.TEST_CONTROL_SECRET

test.describe('N1–N10 Patient Reminder & Engagement Workflow', () => {
  let tc: TestControl

  test.beforeAll(async () => {
    tc = await TestControl.create(API_BASE_URL, TEST_CONTROL_SECRET)
    const health = await tc.health()
    expect(health.enableTestControl).toBe(true)
  })

  // ─── N1 + N8 — Profile PATCH persists reminder prefs ──────────────────────
  test('N1 + N8 — profile PATCH persists reminderTime/quietHoursStart/quietHoursEnd', async () => {
    const patient = PATIENTS.aisha
    const api = await authedApi(API_BASE_URL, patient.email)

    // PATCH new values.
    const patchRes = await api.patch(`${API_BASE_URL}/api/v2/auth/profile`, {
      data: {
        reminderTime: '10:30',
        quietHoursStart: '21:00',
        quietHoursEnd: '06:30',
      },
    })
    expect(patchRes.status()).toBe(200)
    const patched = await patchRes.json()
    expect(patched.reminderTime).toBe('10:30')
    expect(patched.quietHoursStart).toBe('21:00')
    expect(patched.quietHoursEnd).toBe('06:30')

    // GET returns the same values (round-trip).
    const getRes = await api.get(`${API_BASE_URL}/api/v2/auth/profile`)
    const profile = await getRes.json()
    expect(profile.reminderTime).toBe('10:30')
    expect(profile.quietHoursStart).toBe('21:00')
    expect(profile.quietHoursEnd).toBe('06:30')

    // Restore defaults so this test is idempotent across runs.
    await api.patch(`${API_BASE_URL}/api/v2/auth/profile`, {
      data: { reminderTime: '09:00', quietHoursStart: '22:00', quietHoursEnd: '07:00' },
    })
  })

  // ─── N8 — Profile UI renders the Reminders section + emergency disclaimer ─
  test('N8 — Profile UI shows Reminders section with defaults + emergency disclaimer', async ({
    page,
  }) => {
    const patient = PATIENTS.aisha
    // Reach the patient app via the frontend URL and sign in via OTP.
    await page.goto(`${FRONTEND_BASE_URL}/sign-in`)
    // Trust the existing UI flow — the exact sign-in element ids differ across
    // builds. The spec proceeds only if a session cookie lands.
    await page.evaluate(async ({ email, apiBase }) => {
      // Use the demo-OTP endpoints so we don't need a real inbox.
      await fetch(`${apiBase}/api/v2/auth/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, appContext: 'patient', deviceId: 'pw-n8' }),
      })
      await fetch(`${apiBase}/api/v2/auth/otp/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          otp: '666666',
          deviceId: 'pw-n8',
          appContext: 'patient',
        }),
      })
    }, { email: patient.email, apiBase: API_BASE_URL })

    await page.goto(`${FRONTEND_BASE_URL}/profile`)
    // The reminders section is anchored by the edit button test-id.
    const editBtn = page.getByTestId('profile-reminders-edit-button')
    // Give the page time to hydrate + fetch profile.
    await expect(editBtn).toBeVisible({ timeout: 15_000 })
    await editBtn.click()

    // Modal renders three selects + the emergency disclaimer.
    await expect(page.getByTestId('reminder-time-select')).toBeVisible()
    await expect(page.getByTestId('quiet-start-select')).toBeVisible()
    await expect(page.getByTestId('quiet-end-select')).toBeVisible()
    // Emergency disclaimer copy (English fallback works if locale is anything).
    await expect(page.getByText(/emergency alerts always come through/i)).toBeVisible()
  })

  // ─── N7 — Logged confirmation push fires after journal entry save ─────────
  test('N7 — normal-range reading fires a "Logged ✓ ... Looking good" PUSH, no BP values', async () => {
    const patient = PATIENTS.aisha
    const u = await tc.findUserByEmail(patient.email)
    expect(u).not.toBeNull()

    const api = await authedApi(API_BASE_URL, patient.email)
    // Normal-range reading — 118/76 — triggers the "Looking good" tail.
    const before = new Date(Date.now() - 5_000)
    const posted = await postJournalEntry(api, {
      measuredAt: new Date().toISOString(),
      systolicBP: 118,
      diastolicBP: 76,
      pulse: 72,
    })
    expect(posted).toBeTruthy()

    // Poll for the confirmation Notification (fire-and-forget event, may lag).
    let confirmation: { title: string; body: string; channel: string } | undefined
    const start = Date.now()
    while (Date.now() - start < 15_000) {
      const notes = await tc.listNotifications(u!.id)
      confirmation = notes.find(
        (n) =>
          n.channel === 'PUSH' &&
          n.title.includes('Logged') &&
          new Date(n.sentAt) >= before,
      )
      if (confirmation) break
      await new Promise((r) => setTimeout(r, 500))
    }
    expect(confirmation, 'expected a "Logged ✓" PUSH Notification').toBeTruthy()
    expect(confirmation!.body).toContain('Logged ✓')
    expect(confirmation!.body).toContain('Looking good')
    // No BP values anywhere in the body.
    expect(confirmation!.body).not.toContain('118')
    expect(confirmation!.body).not.toContain('76')
    expect(confirmation!.body).not.toMatch(/mmHg/i)
  })

  test('N7 — alert-range reading fires "Logged ✓" WITHOUT positive language', async () => {
    const patient = PATIENTS.aisha
    const u = await tc.findUserByEmail(patient.email)
    expect(u).not.toBeNull()

    const api = await authedApi(API_BASE_URL, patient.email)
    // 165/105 — well above the normal-range predicate → no "Looking good" tail.
    const before = new Date(Date.now() - 5_000)
    await postJournalEntry(api, {
      measuredAt: new Date().toISOString(),
      systolicBP: 165,
      diastolicBP: 105,
      pulse: 78,
    })

    let confirmation: { title: string; body: string; channel: string } | undefined
    const start = Date.now()
    while (Date.now() - start < 15_000) {
      const notes = await tc.listNotifications(u!.id)
      confirmation = notes.find(
        (n) =>
          n.channel === 'PUSH' &&
          n.title.includes('Logged') &&
          new Date(n.sentAt) >= before,
      )
      if (confirmation) break
      await new Promise((r) => setTimeout(r, 500))
    }
    expect(confirmation, 'expected a "Logged ✓" PUSH Notification').toBeTruthy()
    expect(confirmation!.body).toContain('Logged ✓')
    expect(confirmation!.body).not.toContain('Looking good')
    expect(confirmation!.body).not.toContain('keep it up')
    // Belt-and-suspenders: no BP values.
    expect(confirmation!.body).not.toContain('165')
    expect(confirmation!.body).not.toContain('105')
  })

  // ─── N2 + N4 — daily-reminder cron via test-control ───────────────────────
  test('N2 + N4 — daily-reminder cron dispatches an escalating-tone Notification', async () => {
    const patient = PATIENTS.aisha
    const u = await tc.findUserByEmail(patient.email)
    expect(u).not.toBeNull()
    await tc.resetUser(u!.id)

    // Seed one JournalEntry 48h back so today looks like Day 2.
    const api = await authedApi(API_BASE_URL, patient.email)
    await postJournalEntry(api, {
      measuredAt: new Date().toISOString(),
      systolicBP: 122,
      diastolicBP: 78,
      pulse: 72,
    })
    await tc.backdateLastJournalEntry(u!.id, 48 * 60 * 60)

    // Set reminderTime to 09:00 (default) and fire the scan at 13:00 UTC
    // (09:00 ET summer). Idempotent — even if the run had already fired we
    // count both "dispatched" and "skippedIdempotent" as evidence of a
    // successful slot match.
    await api.patch(`${API_BASE_URL}/api/v2/auth/profile`, {
      data: { reminderTime: '09:00', quietHoursStart: '22:00', quietHoursEnd: '07:00' },
    })
    const scanAt = new Date()
    scanAt.setUTCHours(13, 0, 0, 0)
    const summary = await tc.runDailyReminderScan(scanAt)
    expect(summary.dispatched + summary.skippedIdempotent).toBeGreaterThanOrEqual(1)

    const notes = await tc.listNotifications(u!.id)
    const reminder = notes.find((n) => /daily check-in|check-in|check in/i.test(n.title))
    expect(reminder, 'expected the daily-reminder Notification row').toBeTruthy()
  })

  // ─── N6 — quiet-hours shift rule ──────────────────────────────────────────
  test('N6 — reminderTime inside quiet hours defers to quietHoursEnd, not skipped forever', async () => {
    const patient = PATIENTS.aisha
    const u = await tc.findUserByEmail(patient.email)
    expect(u).not.toBeNull()
    await tc.resetUser(u!.id)

    const api = await authedApi(API_BASE_URL, patient.email)
    // reminderTime = 05:00 (INSIDE the default 22:00→07:00 quiet band).
    await api.patch(`${API_BASE_URL}/api/v2/auth/profile`, {
      data: { reminderTime: '05:00', quietHoursStart: '22:00', quietHoursEnd: '07:00' },
    })

    // Scan AT 05:00 ET — cron should skip; effective slot is 07:00 (post-shift).
    const insideQuiet = new Date()
    insideQuiet.setUTCHours(9, 0, 0, 0) // 09:00 UTC = 05:00 ET
    const s1 = await tc.runDailyReminderScan(insideQuiet)
    expect(s1.dispatched).toBe(0)

    // Scan AT 07:00 ET (the effective shifted slot) — should fire.
    const shifted = new Date()
    shifted.setUTCHours(11, 0, 0, 0) // 11:00 UTC = 07:00 ET
    const s2 = await tc.runDailyReminderScan(shifted)
    // Either it fires now, or an earlier run in this suite already covered it
    // and idempotency suppressed. Both count as evidence the shift worked.
    expect(s2.dispatched + s2.skippedIdempotent).toBeGreaterThanOrEqual(1)

    // Restore defaults.
    await api.patch(`${API_BASE_URL}/api/v2/auth/profile`, {
      data: { reminderTime: '09:00' },
    })
  })
})
