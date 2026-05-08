import { test, expect } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { postJournalEntry, adminAcknowledgeAlert } from '../helpers/api.js'
import { HOURS } from '../helpers/time.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Tier 1 escalation ladder (TESTING_FLOW_GUIDE §8.3).
 *
 *   T+0  → primary provider, push+email+dashboard
 *   T+4h → primary + backup, push
 *   T+8h → medical director, push+dashboard
 *   T+24h → HEALPLACE_OPS, push+phone
 *   T+48h → HEALPLACE_OPS, dashboard
 *
 * After-hours: T+0 also fires backup immediately (TIER_1_BACKUP_ON_T0
 * safety-net step). Anchor for ladder deadlines = T+0 actual dispatch
 * notificationSentAt — NOT alert.createdAt.
 *
 * Strategy:
 *   1. trigger Tier 1 by submitting a James reading (NDHP+HFrEF — pre-gate
 *      contraindication, fires regardless of BP)
 *   2. backdate T+0 notificationSentAt by 4h via test-control
 *   3. runScan(now) — should advance to T+4h
 *   4. assert new EscalationEvent at ladderStep=T4H
 *   5. repeat for T+8h, T+24h, T+48h
 */

test.describe('Tier 1 ladder progression via runScan', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('full ladder T+0 → T+4h → T+8h → T+24h → T+48h', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.james.email)
    await tc.resetUser(u.id)

    // Trigger Tier 1
    const patientApi = await authedApi(API_BASE_URL, PATIENTS.james.email)
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 118,
      diastolicBP: 74,
      pulse: 68,
    })
    await new Promise((r) => setTimeout(r, 1500))
    const alerts = await tc.listAlerts(u.id)
    const tier1 = alerts.find((a) => a.tier === 'TIER_1_CONTRAINDICATION')
    expect(tier1).toBeDefined()

    // T+0 should already exist (or fire now via runScan if queued)
    await tc.runEscalationScan(new Date())
    let events = await tc.listEscalationEvents(tier1!.id)
    expect(events.some((e) => e.ladderStep === 'T0')).toBeTruthy()

    // Step the ladder forward via anchor backdate + runScan.
    const steps = [
      { advanceHours: 4, expect: 'T4H' },
      { advanceHours: 4, expect: 'T8H' },
      { advanceHours: 16, expect: 'T24H' },
      { advanceHours: 24, expect: 'T48H' },
    ]
    let cumulativeHours = 0
    for (const s of steps) {
      cumulativeHours += s.advanceHours
      // Backdate the T+0 anchor by the cumulative offset
      await tc.backdateAlertAnchor(tier1!.id, cumulativeHours * 60 * 60)
      await tc.runEscalationScan(new Date())
      events = await tc.listEscalationEvents(tier1!.id)
      expect(
        events.some((e) => e.ladderStep === s.expect),
        `expected ${s.expect} after backdating ${cumulativeHours}h. Steps so far: [${events.map((e) => e.ladderStep).join(',')}]`,
      ).toBeTruthy()
    }

    await patientApi.dispose()
    await tc.dispose()
  })

  test('acknowledged alert stops ladder progression', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.james.email)
    await tc.resetUser(u.id)

    const patientApi = await authedApi(API_BASE_URL, PATIENTS.james.email)
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 118,
      diastolicBP: 74,
      pulse: 68,
    })
    await new Promise((r) => setTimeout(r, 1500))
    const tier1 = (await tc.listAlerts(u.id)).find((a) => a.tier === 'TIER_1_CONTRAINDICATION')
    expect(tier1).toBeDefined()

    // Acknowledge via the ADMIN endpoint. Tier 1 contraindications can only
    // be acknowledged by clinical staff (per spec) — patient-side
    // PATCH /daily-journal/alerts/:id/acknowledge returns 400 here. Cluster-2
    // / B3 reconfirm: original test failure was a silent 400 from patient
    // ack, then "ack didn't stop ladder" because ack never happened.
    const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
    await adminAcknowledgeAlert(adminApi, tier1!.id)

    // Advance 5h — backdateAlertAnchor force-sets notificationSentAt so the
    // anchor calc works even when T+0 was queued for after-hours business
    // open. Use 5h so the deadline is comfortably past.
    await tc.backdateAlertAnchor(tier1!.id, 5 * 60 * 60)
    await tc.runEscalationScan(new Date())
    const events = await tc.listEscalationEvents(tier1!.id)
    expect(events.some((e) => e.ladderStep === 'T4H'), 'ack should stop the ladder').toBeFalsy()

    await patientApi.dispose()
    await adminApi.dispose()
    await tc.dispose()
  })
})

test.describe('BP Level 2 dual-fire at T+0', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('absolute emergency 185/95 fires primary + backup + patient at T+0', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)

    const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 185,
      diastolicBP: 95,
      pulse: 88,
    })
    await new Promise((r) => setTimeout(r, 1500))
    const bpL2 = (await tc.listAlerts(u.id)).find((a) => a.tier === 'BP_LEVEL_2')
    expect(bpL2).toBeDefined()

    const events = await tc.listEscalationEvents(bpL2!.id)
    const t0 = events.find((e) => e.ladderStep === 'T0')
    expect(t0, 'expected T0 event').toBeDefined()
    // T+0 dispatches to PRIMARY_PROVIDER + BACKUP_PROVIDER + PATIENT simultaneously.
    expect(t0!.recipientRoles).toContain('PRIMARY_PROVIDER')
    expect(t0!.recipientRoles).toContain('BACKUP_PROVIDER')
    expect(t0!.recipientRoles).toContain('PATIENT')

    await patientApi.dispose()
    await tc.dispose()
  })

  test('BP L2 fires immediately even after-hours (after-hours = false bypassed)', async () => {
    test.skip(
      true,
      'TODO(next-pass): mock practice business hours via test-control to force after-hours, ' +
        'submit BP L2 reading, assert T0 event has afterHours=true but still fires immediately ' +
        '(no scheduledFor in the future).',
    )
  })
})

test.describe('Pre-enrollment dispatch gate (Layer B)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('NOT_ENROLLED patient: alert created but NO EscalationEvent', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await tc.setEnrollment(u.id, 'NOT_ENROLLED')

    const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 165,
      diastolicBP: 100,
      pulse: 78,
    })
    await new Promise((r) => setTimeout(r, 1500))
    const alerts = await tc.listAlerts(u.id)
    expect(alerts.length, 'alert row should still be created (Layer A allowed it)').toBeGreaterThan(0)

    const aId = alerts[0]!.id
    const events = await tc.listEscalationEvents(aId)
    expect(events.length, 'NO escalation events when NOT_ENROLLED (Layer B gate)').toBe(0)

    // Restore enrolled state for downstream tests
    await tc.setEnrollment(u.id, 'ENROLLED')
    await patientApi.dispose()
    await tc.dispose()
  })
})
