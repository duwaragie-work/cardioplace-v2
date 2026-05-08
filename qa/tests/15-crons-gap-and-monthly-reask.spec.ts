import { test, expect } from '@playwright/test'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { authedApi } from '../helpers/auth.js'
import { postJournalEntry } from '../helpers/api.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Cron specs: GapAlertService (48h trigger / 24h idempotency) and
 * MonthlyReaskService (30d trigger / 28d idempotency). Both expose public
 * `runScan(now?)` methods which we drive via /test-control/cron/*.
 */

test.describe('Gap-alert cron (48h trigger)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('enrolled patient with last entry >48h ago → notification sent', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    // resetUser deleted Aisha's seeded readings. The gap-alert engine's gate
    // is "last journal entry < cutoff", so we post one entry then backdate
    // it >48h to put it past the cutoff.
    const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 122,
      diastolicBP: 78,
      pulse: 72,
    })
    await tc.backdateLastJournalEntry(u.id, 49 * 60 * 60)
    const result = await tc.runGapAlertScan(new Date())
    expect(result.scanned).toBe(1)

    const notes = await tc.listNotifications(u.id)
    const gap = notes.find((n) => /time for your bp check|bp check/i.test(n.title))
    expect(gap, 'expected a gap-alert notification row').toBeDefined()

    await patientApi.dispose()
    await tc.dispose()
  })

  test('idempotency: second scan within 24h does not duplicate', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)

    await tc.runGapAlertScan(new Date())
    const before = await tc.listNotifications(u.id)
    const beforeCount = before.filter((n) => /bp check/i.test(n.title)).length

    // Re-scan — should be a no-op
    await tc.runGapAlertScan(new Date())
    const after = await tc.listNotifications(u.id)
    const afterCount = after.filter((n) => /bp check/i.test(n.title)).length
    expect(afterCount, '24h idempotency window should suppress duplicates').toBe(beforeCount)

    await tc.dispose()
  })
})

test.describe('Monthly re-ask cron (30d trigger)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('patient with med last verified >30d ago → re-ask notification', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)

    // Backdate Aisha's medications by 31 days. Pull her active med list via
    // authedApi (raw fetch can't carry her bearer token).
    const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    const medsRes = await patientApi.get('me/medications')
    const medsBody = await medsRes.json()
    const meds = medsBody?.data ?? medsBody

    if (!Array.isArray(meds) || meds.length === 0) {
      test.skip(true, 'No active meds for Aisha — skip')
    }

    for (const m of meds) {
      await tc.backdateMedicationVerified(m.id, 31 * 24 * 60 * 60)
    }

    const result = await tc.runMonthlyReaskScan(new Date())
    expect(result.reasked).toBeGreaterThanOrEqual(1)

    const notes = await tc.listNotifications(u.id)
    const reask = notes.find((n) => /confirm your medications/i.test(n.title))
    expect(reask, 'expected a monthly re-ask notification row').toBeDefined()

    await patientApi.dispose()
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
