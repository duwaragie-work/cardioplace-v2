import { test, expect } from '@playwright/test'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { authedApi } from '../helpers/auth.js'
import { postJournalEntry } from '../helpers/api.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Cron specs: DailyReminderService (30-min slot / per-user reminderTime) and
 * MonthlyReaskService (30d trigger / 28d idempotency). Both expose public
 * `runScan(now?)` methods which we drive via /test-control/cron/*.
 *
 * N3 (2026-07-13) — the old GapAlertService was deleted; this file's first
 * describe now covers the daily-reminder cron that replaces it.
 */

test.describe('Daily reminder cron (30-min slot, escalating tone)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('enrolled patient at their reminder slot with no reading today → notification sent', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    // Patient needs at least one prior JournalEntry so the day-count math has
    // a "last reading" anchor; backdate it so `now` looks like Day 2.
    const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 122,
      diastolicBP: 78,
      pulse: 72,
    })
    await tc.backdateLastJournalEntry(u.id, 48 * 60 * 60)
    // Fire the scan at 13:00 UTC — 09:00 ET, the default reminderTime.
    const scanAt = new Date()
    scanAt.setUTCHours(13, 0, 0, 0)
    const result = await tc.runDailyReminderScan(scanAt)
    // The scan is idempotent; either it dispatched OR it was already in the
    // idempotency window. Assert one of those held.
    expect(result.dispatched + result.skippedIdempotent).toBeGreaterThanOrEqual(1)

    const notes = await tc.listNotifications(u.id)
    const daily = notes.find((n) => /daily check-in|check-in|check in/i.test(n.title))
    expect(daily, 'expected a daily-reminder notification row').toBeDefined()

    await patientApi.dispose()
    await tc.dispose()
  })

  test('idempotency: second scan within the 20h window does not duplicate', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)

    const scanAt = new Date()
    scanAt.setUTCHours(13, 0, 0, 0)
    await tc.runDailyReminderScan(scanAt)
    const before = await tc.listNotifications(u.id)
    const beforeCount = before.filter((n) => /daily check-in|check-in|check in/i.test(n.title)).length

    // Re-scan at the same slot — should be a no-op
    await tc.runDailyReminderScan(scanAt)
    const after = await tc.listNotifications(u.id)
    const afterCount = after.filter((n) => /daily check-in|check-in|check in/i.test(n.title)).length
    expect(afterCount, '20h idempotency window should suppress duplicates').toBe(beforeCount)

    await tc.dispose()
  })
})

test.describe('Monthly re-ask cron (30d trigger)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('patient with med last verified >30d ago → re-ask notification', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)

    // Backdate every non-discontinued med for Aisha by 31 days. The previous
    // approach looped over `me/medications`, which filters by verification
    // status — so a row left REJECTED by tests/11 was skipped, only Amlodipine
    // got backdated, and the cron's latestTouch still saw Lisinopril's recent
    // verifiedAt and skipped Aisha. The new helper bypasses the patient-side
    // filter and updates every PatientMedication.where(discontinuedAt: null).
    const updated = await tc.backdateAllUserMedications(u.id, 31 * 24 * 60 * 60)
    if (updated.updated === 0) {
      test.skip(true, 'No active meds for Aisha — skip')
    }

    // N6 (2026-07-13) — the monthly-reask cron now suppresses re-asks during
    // the patient's quiet hours (default 22:00–07:00 America/New_York for
    // seeded patients). Passing `new Date()` makes the test dependent on
    // CI wall-clock time: any run that lands the scan between 03:00–12:00 UTC
    // maps to 22:00–07:00 ET and returns reasked=0 correctly. Pin the scan to
    // 14:00 UTC (≈ 10:00 ET) — safely outside every seeded patient's default
    // quiet-hours window — so the cron actually re-asks Aisha.
    const scanAt = new Date()
    scanAt.setUTCHours(14, 0, 0, 0)
    const result = await tc.runMonthlyReaskScan(scanAt)
    expect(result.reasked).toBeGreaterThanOrEqual(1)

    const notes = await tc.listNotifications(u.id)
    const reask = notes.find((n) => /confirm your medications/i.test(n.title))
    expect(reask, 'expected a monthly re-ask notification row').toBeDefined()

    await tc.dispose()
  })

  test('idempotency: 28d window suppresses duplicates', async () => {
    test.skip(
      true,
      'TODO(next-pass): same shape as gap-alert idempotency test, ' +
        'but requires extending test-control with /test-control/medication/list-by-user.',
    )
  })
})
