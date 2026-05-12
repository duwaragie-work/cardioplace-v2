import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { authedApi } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import {
  postJournalEntry,
  adminAcknowledgeAlert,
  adminResolveAlert,
  adminAuditAlert,
} from '../helpers/api.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Admin alert resolution + 15-field audit (TESTING_FLOW_GUIDE §8.4).
 *
 *   Tier 1 / BP L2 — every action requires rationale.
 *   Tier 2 — only TIER2_REVIEWED_NO_ACTION requires rationale.
 *   BP_L2_UNABLE_TO_REACH_RETRY — alert stays OPEN, fresh T+4h scheduled.
 *
 * Each test:
 *   1. resets the patient
 *   2. submits a triggering reading (sets up an OPEN alert)
 *   3. ack + resolve via admin API
 *   4. asserts state transitions + audit endpoint shape
 */

test.describe('Alert resolution', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('Tier 1 (NDHP+HFrEF) — ack then resolve with TIER1_FALSE_POSITIVE', async () => {
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
    const alerts = await tc.listAlerts(u.id)
    const tier1 = alerts.find((a) => a.tier === 'TIER_1_CONTRAINDICATION')
    expect(tier1, `expected TIER_1_CONTRAINDICATION in [${alerts.map((a) => a.tier).join(',')}]`).toBeDefined()

    const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
    await adminAcknowledgeAlert(adminApi, tier1!.id)
    await adminResolveAlert(adminApi, tier1!.id, {
      resolutionAction: 'TIER1_FALSE_POSITIVE',
      resolutionRationale: 'qa-test: medication corrected, patient is not HFrEF after re-review',
    })

    const after = await tc.listAlerts(u.id)
    const resolved = after.find((a) => a.id === tier1!.id)
    expect(resolved?.status).toBe('RESOLVED')

    const audit = await adminAuditAlert(adminApi, tier1!.id)
    // 15 fields per §V2-D.13. Field names vary by version of the audit
    // contract — just confirm an alertId came back. The shape coverage is
    // exercised in the dedicated "audit endpoint returns the 15 expected
    // fields" test below.
    expect(audit.alertId).toBeDefined()
    await patientApi.dispose()
    await adminApi.dispose()
    await tc.dispose()
  })

  test('Tier 1 — missing rationale returns 400', async () => {
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
    const alerts = await tc.listAlerts(u.id)
    const tier1 = alerts.find((a) => a.tier === 'TIER_1_CONTRAINDICATION')
    expect(tier1).toBeDefined()

    const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
    const res = await adminApi.post(`admin/alerts/${tier1!.id}/resolve`, {
      data: { resolutionAction: 'TIER1_FALSE_POSITIVE' /* no rationale */ },
    })
    expect(res.status(), 'expected 400 for Tier 1 without rationale').toBe(400)
    await patientApi.dispose()
    await adminApi.dispose()
    await tc.dispose()
  })

  test('BP_L2_UNABLE_TO_REACH_RETRY schedules retry that fires regardless of ack state', async () => {
    // Cluster-2 / B4 contract per Dr. Singal Option 2:
    //   - Provider acknowledges + chooses "unable to reach, retry in 4h"
    //   - Alert keeps its acknowledgedAt timestamp (audit trail of "I saw this,
    //     I tried"). Status MAY be ACKNOWLEDGED or OPEN; either is fine.
    //   - A fresh EscalationEvent with triggeredByResolution=true is scheduled
    //     for T+4h.
    //   - When that event's scheduledFor passes, firePendingScheduled
    //     dispatches it EVEN IF the alert is ACKNOWLEDGED (the retry was an
    //     explicit provider decision after ack — must not be silently dropped).
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email)

    // 185/95 → BP_LEVEL_2 (absolute emergency rule)
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 185,
      diastolicBP: 95,
      pulse: 88,
    })
    await new Promise((r) => setTimeout(r, 1500))
    const alerts = await tc.listAlerts(u.id)
    const bpL2 = alerts.find((a) => a.tier === 'BP_LEVEL_2')
    expect(bpL2).toBeDefined()

    const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
    await adminAcknowledgeAlert(adminApi, bpL2!.id)
    await adminResolveAlert(adminApi, bpL2!.id, {
      resolutionAction: 'BP_L2_UNABLE_TO_REACH_RETRY',
      resolutionRationale: 'qa-test: tried twice, patient unreachable',
    })

    // A fresh EscalationEvent with triggeredByResolution=true must exist
    let events = await tc.listEscalationEvents(bpL2!.id)
    const retry = events.find((e) => e.triggeredByResolution)
    expect(retry, 'expected a triggeredByResolution=true EscalationEvent').toBeDefined()
    expect(retry?.scheduledFor, 'retry must have scheduledFor in the future').toBeTruthy()
    expect(retry?.notificationSentAt, 'retry not yet dispatched').toBeNull()

    // Status check is now lax — Option 2 keeps acknowledgedAt for audit trail
    const after = await tc.listAlerts(u.id)
    const status = after.find((a) => a.id === bpL2!.id)?.status
    expect(['OPEN', 'ACKNOWLEDGED']).toContain(status)

    // The clinical correctness check: backdate the retry's scheduledFor so
    // the cron sees it as ripe, run scan, assert it dispatched (NOT skipped).
    await tc.backdateRetryEvent(bpL2!.id, 5 * 60 * 60) // 5h backdate
    await tc.runEscalationScan(new Date())
    events = await tc.listEscalationEvents(bpL2!.id)
    const retryAfter = events.find((e) => e.id === retry!.id)
    expect(
      retryAfter?.notificationSentAt,
      'retry MUST dispatch even though alert is ACKNOWLEDGED — silent drop = clinical bug',
    ).not.toBeNull()
    expect(
      retryAfter?.reason,
      `retry should not be skipped. reason: ${retryAfter?.reason}`,
    ).not.toMatch(/skipped/i)

    await patientApi.dispose()
    await adminApi.dispose()
    await tc.dispose()
  })

  test('audit endpoint returns the 15 expected fields', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 165,
      diastolicBP: 100,
      pulse: 78,
    })
    await new Promise((r) => setTimeout(r, 1500))
    const alerts = await tc.listAlerts(u.id)
    const a = alerts[0]
    expect(a).toBeDefined()

    const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
    const audit = await adminAuditAlert(adminApi, a!.id)

    // 15-field Joint Commission audit per CLINICAL_SPEC §V2-D.13. Backend
    // uses *Ms suffix for the two computed time fields — explicit unit per
    // audit-precision convention (cluster-2 / B2 reconfirm). Reads better
    // than ambiguous "time" alone.
    const expected = [
      'alertId',
      'alertType',
      'alertTrigger',
      'patientId',
      'alertGenerationTimestamp',
      'escalationLevel',
      'escalationTimestamp',
      'recipientsNotified',
      'acknowledgmentTimestamp',
      'resolutionTimestamp',
      'timeToAcknowledgmentMs',
      'timeToResolutionMs',
      'escalationTriggered',
      'resolutionAction',
      'resolutionRationale',
    ]
    const missing = expected.filter((k) => !(k in audit))
    expect(missing, `missing audit fields: ${missing.join(',')}`).toEqual([])
    await patientApi.dispose()
    await adminApi.dispose()
    await tc.dispose()
  })
})

test.describe('Bug #6/#7 — clean reading does NOT auto-resolve open BP L1 alerts', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('clean reading after BP_LEVEL_1_HIGH + BP_LEVEL_1_LOW leaves both OPEN with no audit trail breach', async () => {
    // Reproduces production-side bug #6/#7 evidence:
    //   Patient B userId 01KQC9FQJB54CKE3XFQ22C1SJQ
    //   4 prior alerts OPEN/ACK before 12:46:54Z
    //   Reading 5a (BP 120/75, HR 48, no symptoms) fired 0 alerts
    //   All 4 prior alerts flipped to RESOLVED with NULL audit fields
    //   ProfileVerificationLog query shows 0 new rows post-submission
    //
    // Scope: the auto-resolve sweep (alert-engine.service.ts:572-587) only
    // fires for BP_LEVEL_1 tiers, so the trigger must produce those tiers
    // — Tier 1 contraindications and symptom overrides aren't in scope and
    // wouldn't have surfaced the bug. Aisha (65+ HTN, no pregnancy / HF /
    // AFib / HCM) gives a clean BP-only path:
    //   reading 1: 165/95 → STANDARD_L1_HIGH (BP_LEVEL_1_HIGH)
    //   reading 2: 90/55 → AGE_65_LOW (BP_LEVEL_1_LOW; Aisha is 67)
    //   reading 3: 120/75 → 0 alerts (clean)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)

    // Each reading gets its own sessionId so the engine evaluates them
    // independently rather than averaging into a single session.
    const session1 = randomUUID()
    const session2 = randomUUID()
    const session3 = randomUUID()

    // Reading 1 — fires BP_LEVEL_1_HIGH
    await postJournalEntry(api, {
      measuredAt: new Date(Date.now() - 4 * 60_000).toISOString(),
      systolicBP: 165,
      diastolicBP: 95,
      pulse: 78,
      sessionId: session1,
    })
    await new Promise((r) => setTimeout(r, 1500))

    // Reading 2 — fires BP_LEVEL_1_LOW (AGE_65_LOW)
    await postJournalEntry(api, {
      measuredAt: new Date(Date.now() - 2 * 60_000).toISOString(),
      systolicBP: 90,
      diastolicBP: 55,
      pulse: 72,
      sessionId: session2,
    })
    await new Promise((r) => setTimeout(r, 1500))

    const before = await tc.listAlerts(u.id)
    const highAlert = before.find((a) => a.tier === 'BP_LEVEL_1_HIGH')
    const lowAlert = before.find((a) => a.tier === 'BP_LEVEL_1_LOW')
    expect(highAlert, `expected BP_LEVEL_1_HIGH; got tiers: [${before.map((a) => a.tier).join(',')}]`).toBeDefined()
    expect(lowAlert, `expected BP_LEVEL_1_LOW; got tiers: [${before.map((a) => a.tier).join(',')}]`).toBeDefined()
    expect(highAlert?.status).toBe('OPEN')
    expect(lowAlert?.status).toBe('OPEN')

    // Reading 3 — clean. Engine fires 0 new alerts. The bug-#6/#7 sweep
    // would silently flip both prior alerts to RESOLVED with no audit
    // trail. Post-fix, both must remain OPEN.
    await postJournalEntry(api, {
      measuredAt: new Date().toISOString(),
      systolicBP: 120,
      diastolicBP: 75,
      pulse: 72,
      sessionId: session3,
    })
    await new Promise((r) => setTimeout(r, 1500))

    const after = await tc.listAlerts(u.id)
    const highAfter = after.find((a) => a.id === highAlert!.id)
    const lowAfter = after.find((a) => a.id === lowAlert!.id)

    // Critical bug-#6/#7 assertion: status stays OPEN.
    expect(highAfter?.status, 'BP_LEVEL_1_HIGH must remain OPEN after clean reading').toBe('OPEN')
    expect(lowAfter?.status, 'BP_LEVEL_1_LOW must remain OPEN after clean reading').toBe('OPEN')

    // Audit-field invariants: no resolution metadata may be set.
    for (const a of [highAfter, lowAfter]) {
      expect(a?.resolvedBy, `${a?.tier} resolvedBy must be null`).toBeNull()
      expect(a?.resolutionAction, `${a?.tier} resolutionAction must be null`).toBeNull()
      expect(a?.resolvedAt, `${a?.tier} resolvedAt must be null`).toBeNull()
    }

    // No EscalationEvent rows with triggeredByResolution=true should appear
    // — those only come from the explicit /resolve API path (BP L2 retry).
    for (const a of [highAlert!, lowAlert!]) {
      const events = await tc.listEscalationEvents(a.id)
      expect(
        events.every((e) => !e.triggeredByResolution),
        `${a.tier} should have NO triggeredByResolution events; got: ${events.filter((e) => e.triggeredByResolution).map((e) => e.ladderStep).join(',')}`,
      ).toBe(true)
    }

    await api.dispose()
    await tc.dispose()
  })
})

test.describe('Patient acknowledgement (bug #4: propagation to EscalationEvent)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('patient ack writes acknowledgedByUserId AND propagates to EscalationEvent rows', async () => {
    // Reproduces production-side bug #4 evidence: Patient B alert f4058d79.
    // BP_LEVEL_1_HIGH dispatches T+0 to PRIMARY_PROVIDER + PATIENT — both
    // EscalationEvent rows must pick up the patient's ack metadata when
    // PATCH /api/daily-journal/alerts/:id/acknowledge runs. Tier 1 + BP L2
    // are non-dismissable for patients (CLINICAL_SPEC §V2-C) so the same
    // path runs for L1 only — but the propagation logic is the same.
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)

    const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 165,
      diastolicBP: 100,
      pulse: 78,
    })
    await new Promise((r) => setTimeout(r, 1500))

    const alerts = await tc.listAlerts(u.id)
    const bpL1 = alerts.find((a) => a.tier === 'BP_LEVEL_1_HIGH')
    expect(bpL1, `expected BP_LEVEL_1_HIGH alert; got tiers: [${alerts.map((a) => a.tier).join(',')}]`).toBeDefined()

    const eventsBefore = await tc.listEscalationEvents(bpL1!.id)
    expect(
      eventsBefore.length,
      'expected at least one T+0 EscalationEvent for the L1 alert',
    ).toBeGreaterThanOrEqual(1)
    expect(
      eventsBefore.every((e) => e.acknowledgedAt === null && e.acknowledgedBy === null),
      'all EscalationEvent rows should start without ack metadata',
    ).toBe(true)

    const ackRes = await patientApi.patch(`daily-journal/alerts/${bpL1!.id}/acknowledge`)
    expect(ackRes.ok(), `patient ack response: ${ackRes.status()} ${await ackRes.text()}`).toBeTruthy()

    // Allow the txn to settle.
    await new Promise((r) => setTimeout(r, 500))

    // 1. DeviationAlert state — bug #2 fix surface: acknowledgedByUserId must
    // be the patient's own userId.
    const alertsAfter = await tc.listAlerts(u.id)
    const bpL1After = alertsAfter.find((a) => a.id === bpL1!.id)
    expect(bpL1After?.status).toBe('ACKNOWLEDGED')
    expect(
      bpL1After?.acknowledgedAt,
      'DeviationAlert.acknowledgedAt should be set after patient ack',
    ).not.toBeNull()
    expect(
      bpL1After?.acknowledgedByUserId,
      'DeviationAlert.acknowledgedByUserId should be the patient userId',
    ).toBe(u.id)

    // 2. EscalationEvent state — bug #4 fix surface: each row picks up
    // acknowledgedAt + acknowledgedBy from the same transaction.
    const eventsAfter = await tc.listEscalationEvents(bpL1!.id)
    expect(eventsAfter.length).toBe(eventsBefore.length)
    for (const ev of eventsAfter) {
      expect(
        ev.acknowledgedAt,
        `EscalationEvent ${ev.id} (${ev.ladderStep}) should have acknowledgedAt set`,
      ).not.toBeNull()
      expect(
        ev.acknowledgedBy,
        `EscalationEvent ${ev.id} (${ev.ladderStep}) should have acknowledgedBy = patient userId`,
      ).toBe(u.id)
    }

    await patientApi.dispose()
    await tc.dispose()
  })
})
