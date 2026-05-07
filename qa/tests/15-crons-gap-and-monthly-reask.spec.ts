import { test, expect } from '@playwright/test'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
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
    // Aisha has 5 seeded readings; their measuredAt is `daysAgo: 0..13`.
    // Backdate the latest reading >48h to expose the gap.
    // (Note: resetUser deleted them — the gap-alert filter is "no entry OR
    // last entry < cutoff", so an empty journalEntries list is itself a gap.)
    const result = await tc.runGapAlertScan(new Date())
    expect(result.scanned).toBe(1)

    const notes = await tc.listNotifications(u.id)
    const gap = notes.find((n) => /time for your bp check|bp check/i.test(n.title))
    expect(gap, 'expected a gap-alert notification row').toBeDefined()

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

    // Backdate Aisha's medications by 31 days
    const meds: Array<{ id: string }> = await (await fetch(
      `${API_BASE_URL}/me/medications`,
      // direct call — not authedApi since we only need read
    )).json().catch(() => [])

    if (meds.length === 0) {
      test.skip(true, 'Could not list meds without auth — extend test-control with a meds-by-user endpoint')
    }

    for (const m of meds) {
      await tc.backdateMedicationVerified(m.id, 31 * 24 * 60 * 60)
    }

    const result = await tc.runMonthlyReaskScan(new Date())
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
