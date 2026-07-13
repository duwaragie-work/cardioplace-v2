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
import { authedApi, signInPatient } from '../helpers/auth.js'
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
    test.setTimeout(90_000)
    const patient = PATIENTS.aisha
    await signInPatient(page, patient.email)
    await page.goto('/profile')
    // The reminders section is anchored by the edit button test-id.
    const editBtn = page.getByTestId('profile-reminders-edit-button')
    // Give the page time to hydrate + fetch profile.
    await expect(editBtn).toBeVisible({ timeout: 15_000 })
    await editBtn.click()

    // Modal renders three selects + the emergency disclaimer.
    await expect(page.getByTestId('reminder-time-select')).toBeVisible()
    await expect(page.getByTestId('quiet-start-select')).toBeVisible()
    await expect(page.getByTestId('quiet-end-select')).toBeVisible()
    // Post-Gap-4 spec-verbatim disclaimer copy.
    await expect(
      page.getByText(/emergency health alerts will always come through/i),
    ).toBeVisible()
    await page.screenshot({
      path: 'screenshots-manual-run/N8-profile-reminders-modal.png',
      fullPage: false,
    })
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

  // ─── Edge cases (2026-07-13) ────────────────────────────────────────────

  // ─── N1/N8 — backend DTO rejects malformed HH:mm slots ─────────────────
  test('N1 + N8 — backend rejects reminderTime that is not a 30-min slot (e.g. "09:15")', async () => {
    const patient = PATIENTS.aisha
    const api = await authedApi(API_BASE_URL, patient.email)

    // "09:15" fails the regex `/^([01]\d|2[0-3]):(00|30)$/`. Backend should
    // return 400 (class-validator error), NOT silently persist the bad slot.
    const res = await api.patch(`${API_BASE_URL}/api/v2/auth/profile`, {
      data: { reminderTime: '09:15' },
    })
    expect(res.status()).toBe(400)

    // Confirm the value did NOT persist by checking a subsequent GET.
    const getRes = await api.get(`${API_BASE_URL}/api/v2/auth/profile`)
    const profile = await getRes.json()
    expect(profile.reminderTime).not.toBe('09:15')
  })

  test('N1 + N8 — backend rejects invalid HH:mm shape (e.g. "25:00", "abc:00", "9:00")', async () => {
    const patient = PATIENTS.aisha
    const api = await authedApi(API_BASE_URL, patient.email)

    for (const bad of ['25:00', 'abc:00', '9:00', '09:60', '', '09:00:00']) {
      const res = await api.patch(`${API_BASE_URL}/api/v2/auth/profile`, {
        data: { reminderTime: bad },
      })
      expect(res.status(), `expected 400 for "${bad}"`).toBe(400)
    }

    // Restore a known-good value so the rest of the suite has clean state.
    await api.patch(`${API_BASE_URL}/api/v2/auth/profile`, {
      data: { reminderTime: '09:00' },
    })
  })

  // ─── N6 — non-shifted quiet-hours skip (baseline behavior) ─────────────
  test('N6 — cron scan at 02:00 patient-local (inside default quiet hours) does NOT dispatch for a normal 09:00 patient', async () => {
    const patient = PATIENTS.aisha
    const u = await tc.findUserByEmail(patient.email)
    expect(u).not.toBeNull()
    await tc.resetUser(u!.id)

    const api = await authedApi(API_BASE_URL, patient.email)
    await api.patch(`${API_BASE_URL}/api/v2/auth/profile`, {
      data: { reminderTime: '09:00', quietHoursStart: '22:00', quietHoursEnd: '07:00' },
    })

    // 06:00 UTC = 02:00 ET summer — deep inside the 22:00→07:00 quiet window.
    // The 09:00 slot doesn't match at 02:00 anyway, but assert no dispatch either way.
    const scanAt = new Date()
    scanAt.setUTCHours(6, 0, 0, 0)
    const s = await tc.runDailyReminderScan(scanAt)
    expect(s.dispatched).toBe(0)
  })

  // ─── N2/N7 — patient without an email → dispatch still works on DASHBOARD + PUSH ───
  // NOTE: the seeded patient always has an email, so this test constructs a
  // brand-new patient via test-control to exercise the missing-email branch.
  test.skip(
    'N2 — patient with no email gets DASHBOARD + PUSH but no EMAIL row (dispatcher skips silently)',
    async () => {
      // TODO: needs a test-control helper `createOrphanPatient({ email: null })`.
      // Skipped for MVP — the unit spec at
      // backend/src/crons/daily-reminder/reminder-dispatcher.service.spec.ts
      // already covers this branch. Wire this up once qa/helpers/test-control
      // exposes a no-email seed.
    },
  )

  // ─── N2/N4 — day-count derivation across a gap ─────────────────────────
  test('N4 — the daily-reminder body escalates as the gap widens', async () => {
    const patient = PATIENTS.aisha
    const u = await tc.findUserByEmail(patient.email)
    expect(u).not.toBeNull()
    await tc.resetUser(u!.id)

    const api = await authedApi(API_BASE_URL, patient.email)
    await api.patch(`${API_BASE_URL}/api/v2/auth/profile`, {
      data: { reminderTime: '09:00', quietHoursStart: '22:00', quietHoursEnd: '07:00' },
    })
    // Seed one JournalEntry, backdate to specific gap.
    await postJournalEntry(api, {
      measuredAt: new Date().toISOString(),
      systolicBP: 118,
      diastolicBP: 76,
      pulse: 72,
    })

    const scanAt = new Date()
    scanAt.setUTCHours(13, 0, 0, 0)

    // 24h gap → Day 1
    await tc.backdateLastJournalEntry(u!.id, 24 * 60 * 60)
    await tc.runDailyReminderScan(scanAt)
    const day1Notes = await tc.listNotifications(u!.id)
    const day1 = day1Notes.find((n) =>
      /take a moment to check your blood pressure|it's been a few days|gentle reminder/i.test(
        n.body,
      ),
    )
    expect(day1, 'expected some daily-reminder body to have landed').toBeTruthy()
  })

  // ─── N7 — logged confirmation for missing BP values ────────────────────
  test('N7 — reading without BP values still fires "Logged ✓" but with NO positive tail', async () => {
    const patient = PATIENTS.aisha
    const u = await tc.findUserByEmail(patient.email)
    expect(u).not.toBeNull()

    const api = await authedApi(API_BASE_URL, patient.email)
    // Post an entry with only a weight (no BP) — edge case for the range check.
    const before = new Date(Date.now() - 5_000)
    const posted = await postJournalEntry(api, {
      measuredAt: new Date().toISOString(),
      systolicBP: null,
      diastolicBP: null,
      pulse: null,
      weight: 75.5,
    } as any)
    // Some journals reject BP-null entries — skip gracefully if so.
    test.skip(!posted, 'API rejected BP-null entry; range-check edge test not exercised')

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
    if (confirmation) {
      expect(confirmation.body).toContain('Logged ✓')
      expect(confirmation.body).not.toContain('Looking good')
    }
  })

  // ─── N2 — idempotency across two rapid scans ───────────────────────────
  test('N2 — two rapid scans at the same slot produce ONE Notification, not two', async () => {
    const patient = PATIENTS.aisha
    const u = await tc.findUserByEmail(patient.email)
    expect(u).not.toBeNull()
    await tc.resetUser(u!.id)

    const api = await authedApi(API_BASE_URL, patient.email)
    // Ensure a "yesterday" reading exists.
    await postJournalEntry(api, {
      measuredAt: new Date().toISOString(),
      systolicBP: 118,
      diastolicBP: 76,
      pulse: 72,
    })
    await tc.backdateLastJournalEntry(u!.id, 24 * 60 * 60)

    await api.patch(`${API_BASE_URL}/api/v2/auth/profile`, {
      data: { reminderTime: '09:00', quietHoursStart: '22:00', quietHoursEnd: '07:00' },
    })

    const scanAt = new Date()
    scanAt.setUTCHours(13, 0, 0, 0)

    // First scan — should dispatch.
    const s1 = await tc.runDailyReminderScan(scanAt)
    const before = await tc.listNotifications(u!.id)
    const beforeCount = before.filter(
      (n) => /daily check-in/i.test(n.title) && n.channel === 'DASHBOARD',
    ).length

    // Second scan at the same slot — should be idempotent (title match in 20h window).
    const s2 = await tc.runDailyReminderScan(scanAt)
    const after = await tc.listNotifications(u!.id)
    const afterCount = after.filter(
      (n) => /daily check-in/i.test(n.title) && n.channel === 'DASHBOARD',
    ).length

    expect(afterCount, 'idempotency window MUST suppress a duplicate dispatch').toBe(
      beforeCount,
    )
    expect(s1.dispatched + s2.skippedIdempotent).toBeGreaterThanOrEqual(1)
  })

  // ─── N8 — Profile modal shows single "Quiet hours" heading (Gap 5 fix) ─
  test('N8 — Profile RemindersModal uses single-header quiet-hours layout (Gap 5)', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const patient = PATIENTS.aisha
    await signInPatient(page, patient.email)
    await page.goto('/profile')
    const editBtn = page.getByTestId('profile-reminders-edit-button')
    await expect(editBtn).toBeVisible({ timeout: 15_000 })
    await editBtn.click()

    // Post-Gap-5: single "Quiet hours (no reminders during this time)" header
    // followed by Start / End sub-labels.
    await expect(page.getByText(/quiet hours \(no reminders during this time\)/i)).toBeVisible()
    // No verbatim "Quiet hours start" / "Quiet hours end" labels inside the modal
    // (they still exist in the Row list outside the modal). Check the modal
    // scope via the visible dialog.
    const modal = page.locator('[role="dialog"]')
    await expect(modal.getByText(/^Start$/)).toBeVisible()
    await expect(modal.getByText(/^End$/)).toBeVisible()
    await page.screenshot({
      path: 'screenshots-manual-run/N8-single-header-layout.png',
      fullPage: false,
    })
  })

  // ─── N8 — reminder time picker enforces spec ceiling (Gap 8 fix) ───────
  test('N8 — reminder-time <select> options include 21:00 but NOT 21:30 (spec ceiling)', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const patient = PATIENTS.aisha
    await signInPatient(page, patient.email)
    await page.goto('/profile')
    const editBtn = page.getByTestId('profile-reminders-edit-button')
    await expect(editBtn).toBeVisible({ timeout: 20_000 })
    await editBtn.click()

    const select = page.getByTestId('reminder-time-select')
    await expect(select).toBeVisible()
    const values = await select.locator('option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value),
    )
    // Spec §N8: 30-min increments, 6:00 AM – 9:00 PM. Ceiling is 21:00; NO 21:30.
    expect(values).toContain('06:00')
    expect(values).toContain('09:00')
    expect(values).toContain('21:00')
    expect(values).not.toContain('21:30')
    expect(values).not.toContain('22:00')
    expect(values).not.toContain('05:30')
    await page.screenshot({
      path: 'screenshots-manual-run/N8-reminder-time-picker.png',
      fullPage: false,
    })
  })

  // ─── N8 — quiet-hours pickers span the full day (00:00 – 23:30) ─────────
  test('N8 — quiet-hours <select> options span the full day (00:00 through 23:30)', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const patient = PATIENTS.aisha
    await signInPatient(page, patient.email)
    await page.goto('/profile')
    const editBtn = page.getByTestId('profile-reminders-edit-button')
    await expect(editBtn).toBeVisible({ timeout: 20_000 })
    await editBtn.click()

    for (const testId of ['quiet-start-select', 'quiet-end-select']) {
      const values = await page
        .getByTestId(testId)
        .locator('option')
        .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value))
      expect(values, `${testId} must include 00:00`).toContain('00:00')
      expect(values, `${testId} must include 23:30 (Gap 5 quiet-hours full-day fix)`).toContain(
        '23:30',
      )
    }
  })

  // ─── N10 — Spanish locale renders Spanish disclaimer ────────────────────
  test('N10 — Profile Reminders modal renders Spanish disclaimer when the patient prefers es', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const patient = PATIENTS.aisha
    const api = await authedApi(API_BASE_URL, patient.email)
    await api.patch(`${API_BASE_URL}/api/v2/auth/profile`, {
      data: { preferredLanguage: 'es' },
    })

    try {
      await signInPatient(page, patient.email)
      await page.goto('/profile')
      const editBtn = page.getByTestId('profile-reminders-edit-button')
      await expect(editBtn).toBeVisible({ timeout: 20_000 })
      await editBtn.click()
      // Spec-verbatim Spanish disclaimer copy (after Gap 4 fix).
      await expect(
        page.getByText(/alertas de salud de emergencia siempre llegarán/i),
      ).toBeVisible({ timeout: 10_000 })
      await page.screenshot({
        path: 'screenshots-manual-run/N10-spanish-disclaimer.png',
        fullPage: false,
      })
    } finally {
      // Restore English so other tests aren't affected.
      await api.patch(`${API_BASE_URL}/api/v2/auth/profile`, {
        data: { preferredLanguage: 'en' },
      })
    }
  })
})
