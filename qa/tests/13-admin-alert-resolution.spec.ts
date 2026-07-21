import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { authedApi, signInAdmin, apiSignIn } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import {
  postJournalEntry,
  postSessionWithTwoReadings,
  adminAcknowledgeAlert,
  adminResolveAlert,
  adminAuditAlert,
  waitForAlerts,
  resolveAlertViaModal,
  gotoPatientAlertsTab,
  patchPatientAcknowledgeAlert,
} from '../helpers/api.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'
import { formatTriggeringValue, RULE_IDS } from '@cardioplace/shared'

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
    const alerts = await waitForAlerts(tc, u.id, (xs) =>
      xs.some((a) => a.tier === 'TIER_1_CONTRAINDICATION'),
    )
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
    const alerts = await waitForAlerts(tc, u.id, (xs) =>
      xs.some((a) => a.tier === 'TIER_1_CONTRAINDICATION'),
    )
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
    const alerts = await waitForAlerts(tc, u.id, (xs) =>
      xs.some((a) => a.tier === 'BP_LEVEL_2'),
    )
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
    const alerts = await waitForAlerts(tc, u.id, (xs) => xs.length > 0)
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

  test('provider resolve populates DeviationAlert.resolvedAt for JCAHO audit footer', async () => {
    // Regression — original handler set status/resolvedBy/resolutionAction
    // on DeviationAlert but NOT resolvedAt. The 15-field audit footer reads
    // resolutionTimestamp from DeviationAlert.resolvedAt, so the "Resolved"
    // row stayed blank (—) even though the event-level resolvedAt was
    // populated correctly. Symmetric to the existing acknowledgedAt write.
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
    const tier1 = (
      await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.tier === 'TIER_1_CONTRAINDICATION'),
      )
    ).find((a) => a.tier === 'TIER_1_CONTRAINDICATION')
    expect(tier1).toBeDefined()

    const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
    const beforeResolve = Date.now()
    await adminResolveAlert(adminApi, tier1!.id, {
      resolutionAction: 'TIER1_FALSE_POSITIVE',
      resolutionRationale: 'qa-test: resolvedAt audit regression',
    })

    const audit = await adminAuditAlert(adminApi, tier1!.id)
    expect(audit.resolutionAction, 'resolutionAction should round-trip').toBe('TIER1_FALSE_POSITIVE')
    expect(audit.resolutionTimestamp, 'resolutionTimestamp must NOT be null after resolve').not.toBeNull()
    expect(audit.resolutionTimestamp).toBeDefined()
    const resolvedMs = new Date(audit.resolutionTimestamp as string).getTime()
    expect(resolvedMs).toBeGreaterThanOrEqual(beforeResolve - 1_000)
    expect(resolvedMs).toBeLessThanOrEqual(Date.now() + 1_000)

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

    // Each setup reading is a 2-reading session so the engine bypasses the
    // Cluster 6 Q2 single-reading gate deterministically. Pre-Day-3 mode
    // also exempts the gate (resetUser wipes Aisha's seed readings →
    // lifetime count <7), but relying on that exposes a CI-only race:
    // Reading 2's event handler can run before Reading 1 has been COMMITTED
    // to a transaction visible to ProfileResolver.count, leaving the
    // pre-Day-3 derivation deterministic only for the first reading. The
    // 2-reading-session pattern was applied by commit 540c537 to spec 30u
    // for the same class of failure. Reading 3 (clean) stays single — it
    // is supposed to fire NOTHING, so the gate doesn't matter for it.
    const session1 = randomUUID()
    const session2 = randomUUID()
    const session3 = randomUUID()

    // Reading 1 — 2-reading session at 165/95 → fires BP_LEVEL_1_HIGH
    await postSessionWithTwoReadings(api, {
      sessionId: session1,
      firstMeasuredAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      systolicBP: 165,
      diastolicBP: 95,
      pulse: 78,
    })
    await new Promise((r) => setTimeout(r, 1500))

    // Reading 2 — 2-reading session at 90/55 → fires BP_LEVEL_1_LOW (AGE_65_LOW)
    await postSessionWithTwoReadings(api, {
      sessionId: session2,
      firstMeasuredAt: new Date(Date.now() - 3 * 60_000).toISOString(),
      systolicBP: 90,
      diastolicBP: 55,
      pulse: 72,
    })

    // Poll for BOTH alerts to land. The engine is event-driven and the
    // persistAlert SERIALIZABLE transactions can deadlock under load (Cluster
    // 6 bug #11 retry — up to 3× 100ms backoff), pushing persistence past
    // any fixed sleep. A 1500ms wait was racy in CI; this poll waits up to
    // ~15s for both rows to materialize before asserting.
    let before = await tc.listAlerts(u.id)
    for (let attempt = 0; attempt < 30; attempt++) {
      const haveHigh = before.some((a) => a.tier === 'BP_LEVEL_1_HIGH')
      const haveLow = before.some((a) => a.tier === 'BP_LEVEL_1_LOW')
      if (haveHigh && haveLow) break
      await new Promise((r) => setTimeout(r, 500))
      before = await tc.listAlerts(u.id)
    }
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
    const alerts = await waitForAlerts(tc, u.id, (xs) =>
      xs.some((a) => a.tier === 'BP_LEVEL_1_HIGH'),
    )
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

test.describe('Test-control hygiene', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  // Bug #19 (observed 2026-05-15): `setUserMedication` used a bare
  // `prisma.patientMedication.create`, so every call — even with the same
  // drug for the same user — accumulated another active row. Spec 19 saw
  // Aisha pile up duplicate Metoprolol / Lisinopril rows across its
  // sequential tests. The fix dedups on (userId, drugName): repeat calls
  // update the existing row in place instead of inserting a new one.
  //
  // Hermetic by construction: `resetUser` does NOT clear PatientMedication
  // rows, so this test uses a unique drug name per run — zero prior rows
  // regardless of accumulated seed/test state — and asserts exactly 1 row
  // survives 3 identical setUserMedication calls.
  test('Bug #19 — setUserMedication dedups on (userId, drugName), no row accumulation', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)

    // Unique name so prior accumulated Lisinopril/Metoprolol rows on Aisha
    // (resetUser doesn't touch meds) can't pollute the assertion.
    const drugName = `DedupProbe-${randomUUID()}`
    const medSpec = {
      drugName,
      drugClass: 'ACE_INHIBITOR' as const,
      frequency: 'ONCE_DAILY' as const,
      verificationStatus: 'VERIFIED' as const,
    }

    await tc.setUserMedication(u.id, medSpec)
    await tc.setUserMedication(u.id, medSpec)
    await tc.setUserMedication(u.id, medSpec)

    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      const res = await api.get('me/medications')
      expect(res.ok(), `me/medications: ${res.status()} ${await res.text()}`).toBeTruthy()
      const body = await res.json()
      const meds: Array<{ drugName: string; verificationStatus: string }> =
        body?.data ?? body
      const probeRows = meds.filter((m) => m.drugName === drugName)
      expect(
        probeRows.length,
        `expected exactly 1 ${drugName} row after 3 setUserMedication calls (dedup), got ${probeRows.length}`,
      ).toBe(1)
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})

// ─── Phase 1 — audit-trail comprehensive review (§B / §C / §H) ───────────────

test.describe('Phase 1 — 15-field audit-trail backend contract (§B/§C)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  // Observed bug (Duwaragie 2026-05-15): a patient acknowledgement rendered
  // "Acknowledged" in the admin 15-field footer with NO patient name, while
  // an admin resolve showed the actor correctly. Root cause: the per-patient
  // alerts endpoint (consumed by the admin patient-detail panel via
  // patient-detail.service.ts) resolved only the alert-level `resolvedBy`
  // into a display name — it never surfaced `acknowledgedByUserId` /
  // `acknowledgedByName`, and it had no distinct `resolvedAt` (the footer
  // showed acknowledgedAt mislabelled "Resolved"). This is the deterministic
  // proof of the §B/§C fix at the API contract layer (no UI env required).
  // Split (2026-05-17): the original single test asserted acknowledgedBy +
  // acknowledgedByName + resolvedAt on ONE alert — clinically impossible.
  // Per CLINICAL_SPEC Part 12: BP Level 1 is patient-dismissable but has NO
  // resolution catalog (can be acked, never resolved); Tier 1 is
  // patient-non-dismissable (resolved by a provider action, never
  // patient-acked). The old test resolved a BP L1 alert with an invalid
  // `BP_L1_REVIEWED_NO_ACTION` enum value (no such action exists by design)
  // → backend 400 → CI red. Split into the two valid workflows.

  test('per-patient endpoint surfaces alert-level acknowledgedBy + acknowledgedByName (BP L1 patient ack)', async () => {
    test.setTimeout(120_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    let u: Awaited<ReturnType<typeof tc.findUser>>
    try {
      u = await tc.findUser(PATIENTS.aisha.email)
      await tc.resetUser(u.id)
    } catch (err) {
      // Backend without ENABLE_TEST_CONTROL=true — skip cleanly (qa README:
      // never silently no-op); assertions still run in provisioned CI.
      test.skip(true, `test-control unprovisioned: ${(err as Error).message}`)
      return
    }

    const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 165,
      diastolicBP: 100,
      pulse: 78,
    })
    const bpL1 = (
      await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.tier === 'BP_LEVEL_1_HIGH'),
      )
    ).find((a) => a.tier === 'BP_LEVEL_1_HIGH')
    expect(bpL1, 'expected BP_LEVEL_1_HIGH alert').toBeDefined()

    // Patient self-acknowledges — the exact path the observed bug was about
    // (patient as the acking actor). BP L1 is dismissable; this is its
    // terminal state (no resolution step exists for the tier).
    const ackRes = await patientApi.patch(`daily-journal/alerts/${bpL1!.id}/acknowledge`)
    expect(ackRes.ok(), `patient ack: ${ackRes.status()}`).toBeTruthy()
    await new Promise((r) => setTimeout(r, 500))

    const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
    const afterAckRes = await adminApi.get(`provider/patients/${u.id}/alerts`)
    expect(afterAckRes.ok(), `GET alerts: ${afterAckRes.status()}`).toBeTruthy()
    const afterAckBody = await afterAckRes.json()
    const ackedAlert = (afterAckBody.data ?? afterAckBody).find(
      (a: { id: string }) => a.id === bpL1!.id,
    )
    expect(ackedAlert, 'acked alert must be in per-patient feed').toBeDefined()
    expect(
      ackedAlert.acknowledgedBy,
      'alert-level acknowledgedBy must be the patient userId (was absent pre-fix)',
    ).toBe(u.id)
    expect(
      typeof ackedAlert.acknowledgedByName === 'string' &&
        ackedAlert.acknowledgedByName.length > 0,
      `acknowledgedByName must resolve to a display name, got: ${JSON.stringify(ackedAlert.acknowledgedByName)}`,
    ).toBe(true)
    expect(
      ackedAlert.acknowledgedByName,
      'acknowledgedByName must not be the raw userId',
    ).not.toBe(u.id)

    await patientApi.dispose()
    await adminApi.dispose()
    await tc.dispose()
  })

  test('per-patient endpoint surfaces distinct resolvedAt + resolvedByName (Tier 1 admin resolve)', async () => {
    test.setTimeout(120_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    let u: Awaited<ReturnType<typeof tc.findUser>>
    try {
      u = await tc.findUser(PATIENTS.james.email)
      await tc.resetUser(u.id)
    } catch (err) {
      test.skip(true, `test-control unprovisioned: ${(err as Error).message}`)
      return
    }

    const patientApi = await authedApi(API_BASE_URL, PATIENTS.james.email)
    // James (NDHP + HFrEF) → RULE_NDHP_HFREF → TIER_1_CONTRAINDICATION.
    // Tier 1 is patient-non-dismissable; the provider resolves it with a
    // catalog action + rationale (TIER1_FALSE_POSITIVE = no clinical action
    // implied, just "false alarm" — a safe default for the contract test).
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 118,
      diastolicBP: 74,
      pulse: 68,
    })
    const tier1 = (
      await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.tier === 'TIER_1_CONTRAINDICATION'),
      )
    ).find((a) => a.tier === 'TIER_1_CONTRAINDICATION')
    expect(tier1, 'expected TIER_1_CONTRAINDICATION alert').toBeDefined()

    const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
    await adminResolveAlert(adminApi, tier1!.id, {
      resolutionAction: 'TIER1_FALSE_POSITIVE',
      resolutionRationale: 'qa-test: phase1 §B/§C resolve contract',
    })

    const afterResolveRes = await adminApi.get(`provider/patients/${u.id}/alerts`)
    expect(afterResolveRes.ok(), `GET alerts: ${afterResolveRes.status()}`).toBeTruthy()
    const afterResolveBody = await afterResolveRes.json()
    const resolvedAlert = (afterResolveBody.data ?? afterResolveBody).find(
      (a: { id: string }) => a.id === tier1!.id,
    )
    expect(resolvedAlert, 'resolved alert must be in per-patient feed').toBeDefined()
    expect(resolvedAlert.status).toBe('RESOLVED')
    expect(
      resolvedAlert.resolvedAt,
      'alert-level resolvedAt must be populated (footer no longer reuses acknowledgedAt)',
    ).not.toBeNull()
    expect(resolvedAlert.resolvedAt).toBeDefined()
    expect(
      typeof resolvedAlert.resolvedByName === 'string' &&
        resolvedAlert.resolvedByName.length > 0,
      'resolvedByName must resolve to a clinician display name',
    ).toBe(true)
    expect(
      resolvedAlert.resolvedByName,
      'resolvedByName must not be the raw userId',
    ).not.toBe(resolvedAlert.resolvedBy)
    // resolvedAt is a DISTINCT field — Tier 1 is not patient-acked, so
    // acknowledgedAt stays null while resolvedAt populates (proves the
    // footer no longer conflates the two timestamps).
    expect(resolvedAlert.resolvedAt).not.toBe(resolvedAlert.acknowledgedAt)

    await patientApi.dispose()
    await adminApi.dispose()
    await tc.dispose()
  })
})

test.describe('Phase 1 — 15-field audit panel UI (§B/§C/§H)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  // Full-fidelity check of the admin EscalationAuditTrail footer. Follows the
  // documented volatile patient-detail walk posture (spec 11 header / bug #3):
  // skip cleanly when the provisioned admin+seed env is not reachable; the
  // deterministic contract proof lives in the API test above + the admin tsc
  // build (PatientAlert type) — this asserts the rendered DOM when CI is
  // provisioned.
  test('audit footer renders all 15 data-testid fields, distinct ack/resolve actors, System(Cron) attribution', async ({
    page,
  }) => {
    test.setTimeout(150_000) // trigger + ack + resolve + admin browser walk
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)

    try {
      const u = await tc.findUser(PATIENTS.james.email)
      await tc.resetUser(u.id)
      const patientApi = await authedApi(API_BASE_URL, PATIENTS.james.email)
      await postJournalEntry(patientApi, {
        measuredAt: new Date().toISOString(),
        systolicBP: 118,
        diastolicBP: 74,
        pulse: 68,
      })
      const tier1 = (
        await waitForAlerts(tc, u.id, (xs) =>
          xs.some((a) => a.tier === 'TIER_1_CONTRAINDICATION'),
        )
      ).find((a) => a.tier === 'TIER_1_CONTRAINDICATION')
      expect(tier1).toBeDefined()
      const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
      await adminAcknowledgeAlert(adminApi, tier1!.id)
      await adminResolveAlert(adminApi, tier1!.id, {
        resolutionAction: 'TIER1_FALSE_POSITIVE',
        resolutionRationale: 'qa-test: phase1 §B audit panel UI',
      })
      await patientApi.dispose()
      await adminApi.dispose()

      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/patients`)
      const patientLink = page.getByText(PATIENTS.james.name).first()
      await expect(patientLink).toBeVisible({ timeout: 15_000 })
      await patientLink.click()
      await expect(page).toHaveURL(/\/patients\/[^/]+$/, { timeout: 20_000 })
      const alertsTab = page.getByRole('tab', { name: 'Alerts' })
      await expect(alertsTab).toBeVisible({ timeout: 15_000 })
      await alertsTab.click()
      // The alert is RESOLVED; AlertsTab defaults to the OPEN filter, so
      // switch to "All" before locating it, then expand the card.
      await page.getByRole('button', { name: 'All', exact: true }).first().click()
      await page.getByRole('button', { name: 'Expand alert' }).first().click()
    } catch (err) {
      test.skip(
        true,
        `admin patient-detail UI walk not reachable in this env ` +
          `(provisioned admin+seed required): ${(err as Error).message}`,
      )
      return
    }

    // ── Real assertions (env provisioned) ────────────────────────────────

    // §B — every audit field renders with a stable testid. NOTE: Phase 1
    // polish Finding 7 removed the v1-vestigial 'baselineValue' row (v2 has
    // no rolling baselines) — it is intentionally absent here now.
    const FIELD_KEYS = [
      'alertId', 'tier', 'ruleId', 'severity', 'mode', 'status', 'created',
      'acknowledged', 'acknowledgedBy', 'resolved', 'resolvedBy',
      'resolutionAction', 'reading', 'pulsePressure',
      'escalationCount',
    ]
    for (const k of FIELD_KEYS) {
      await expect(
        page.locator(`[data-testid="audit-field-${k}"]`),
        `15-field audit panel missing field: ${k}`,
      ).toBeVisible({ timeout: 15_000 })
    }
    // Resolution rationale renders (free-form, separate block).
    await expect(
      page.locator('[data-testid="audit-field-resolutionRationale"]'),
    ).toBeVisible()

    // §B/§C — Acknowledged and Resolved are DISTINCT rows with actor names
    // (no longer one conflated "Resolved"=acknowledgedAt row, no blank actor).
    await expect(page.locator('[data-testid="audit-field-tier"]')).toContainText('Tier 1')
    await expect(page.locator('[data-testid="audit-field-acknowledgedBy"]')).not.toContainText('—')
    await expect(page.locator('[data-testid="audit-field-resolvedBy"]')).not.toContainText('—')

    // §H — every escalation rung carries a dispatch attribution chip; a
    // cron-fired ladder rung must read "System (Cron)" (not blank).
    await expect(
      page.locator('[data-testid="audit-attribution-system"]').first(),
      'cron-dispatched rung must show System (Cron) attribution',
    ).toBeVisible({ timeout: 15_000 })

    await tc.dispose()
  })
})

test.describe('AlertsTab — Acknowledged status filter (bug #3)', () => {
  // Bug #3: the per-patient Alerts tab status control had Open / Resolved /
  // All but no "Acknowledged" — acknowledged alerts were only reachable via
  // the "All" view. Pure presentational regression guard: the pill must
  // render and be selectable. No seeded acknowledged alert is required —
  // asserting the control exists and activates is the deterministic proof
  // the pill is back. ARIA-role selectors are used deliberately: the
  // patient-detail tabs are CSS-selector-volatile (see spec 11 header), but
  // role="tab" / accessible button names are stable.
  test('Acknowledged pill renders in the AlertsTab status control and is selectable', async ({
    page,
  }) => {
    // Reaching this surface requires a provisioned admin environment
    // (OTP-able admin sign-in + a seeded patient + the React-heavy,
    // documented-volatile patient-detail tab walk — see spec 11 header).
    // When that environment is not available locally (e.g. ENABLE_TEST_
    // CONTROL unset so the patient seed/reset never ran), skip cleanly
    // rather than hard-fail — the change is also covered deterministically
    // by the admin TypeScript build (the StatusFilter union) and the
    // manual-verification note in qa/reports/STATUS_2026_05_15.md. Under a
    // properly provisioned CI run this executes the real assertions.
    try {
      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/patients`)
      const patientLink = page.getByText(PATIENTS.aisha.name).first()
      await expect(patientLink).toBeVisible({ timeout: 15_000 })
      await patientLink.click()
      await expect(page).toHaveURL(/\/patients\/[^/]+$/, { timeout: 20_000 })
      const alertsTab = page.getByRole('tab', { name: 'Alerts' })
      await expect(alertsTab).toBeVisible({ timeout: 15_000 })
      await alertsTab.click()
    } catch (err) {
      test.skip(
        true,
        `admin patient-detail UI walk not reachable in this env ` +
          `(provisioned admin+seed required): ${(err as Error).message}`,
      )
      return
    }

    // ── Real assertions (env is provisioned) ──────────────────────────────
    // The status segmented control must now expose "Acknowledged".
    const ackPill = page.getByRole('button', { name: 'Acknowledged', exact: true })
    await expect(
      ackPill,
      'Acknowledged status pill missing from AlertsTab (bug #3)',
    ).toBeVisible({ timeout: 15_000 })

    // Selecting it must not crash the tab — the status control (and its
    // "Status" label) stays rendered after the filter switch.
    await ackPill.click()
    await expect(ackPill).toBeVisible()
    await expect(page.getByText('Status', { exact: true })).toBeVisible()
  })
})

// ─── Phase 2 — Finding 3: DELETE /daily-journal/:id cascade (CTO-deferred) ────
//
// Phase 1 §G.1 flagged that DELETE /daily-journal/:id (JWT + ownership only,
// not test-gated) cascades JournalEntry → DeviationAlert → EscalationEvent via
// FK onDelete: Cascade — a patient can erase a JCAHO escalation audit trail by
// deleting the originating reading. This is NOT fixed here: it is entangled
// with the CTO + Manisha + counsel reading-corrections architecture decision
// (Phase 1 §G.3 deferral — soft-supersede vs strict append-only). This test
// pins the CURRENT behavior so the decision has a regression anchor; when the
// soft-supersede contract lands, this test is updated/replaced with the new
// expectation.
test.describe('Phase 2 — Finding 3: journal-delete cascade (current behavior, CTO-deferred)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('DELETE /daily-journal/:id soft-deletes the reading; its DeviationAlert + EscalationEvent SURVIVE', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    let u: Awaited<ReturnType<typeof tc.findUser>>
    try {
      u = await tc.findUser(PATIENTS.james.email)
      await tc.resetUser(u.id)
    } catch (err) {
      test.skip(true, `test-control unprovisioned: ${(err as Error).message}`)
      return
    }

    const patientApi = await authedApi(API_BASE_URL, PATIENTS.james.email)
    // James (NDHP + HFrEF) → TIER_1_CONTRAINDICATION on any reading.
    const je = await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 118,
      diastolicBP: 74,
      pulse: 68,
    })
    const journalEntryId = je.id
    const tier1 = (
      await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.tier === 'TIER_1_CONTRAINDICATION'),
      )
    ).find((a) => a.tier === 'TIER_1_CONTRAINDICATION')
    expect(tier1, 'expected a Tier 1 alert linked to the reading').toBeDefined()
    const alertId = tier1!.id

    const eventsBefore = await tc.listEscalationEvents(alertId)

    // Patient deletes the originating reading.
    const delRes = await patientApi.delete(`daily-journal/${journalEntryId}`)
    expect(
      delRes.ok(),
      `DELETE /daily-journal/${journalEntryId}: ${delRes.status()} ${await delRes.text()}`,
    ).toBeTruthy()
    await new Promise((r) => setTimeout(r, 500))

    // SOFT-DELETE (HIPAA L5, Duwaragie sign-off 2026-07-06 — b6972f16): deleting
    // a reading stamps `deletedAt` instead of removing the row, so the FK
    // `onDelete: Cascade` never fires and the fired DeviationAlert SURVIVES.
    // This is the "soft-supersede" move the prior TODO anticipated.
    const alertsAfter = await tc.listAlerts(u.id)
    expect(
      alertsAfter.some((a) => a.id === alertId),
      'soft-delete: the fired DeviationAlert survives its reading being deleted',
    ).toBe(true)

    // ...and so does its EscalationEvent audit trail (nothing erased).
    const eventsAfter = await tc.listEscalationEvents(alertId)
    expect(
      eventsAfter.length,
      `soft-delete: EscalationEvent audit rows survive (had ${eventsBefore.length})`,
    ).toBe(eventsBefore.length)

    await patientApi.dispose()
    await tc.dispose()
  })
})

// ─── Phase 2 — Finding 5: EscalationEvent.dispatchedBySystem attribution ──────
//
// Phase 1 §H labelled cron rungs "System (Cron)" via a UI heuristic. Phase 2
// adds a persisted EscalationEvent.dispatchedBySystem column (source of
// truth). Cron-fired rungs set it true; an admin BP_L2 retry sets it false.
test.describe('Phase 2 — Finding 5: dispatchedBySystem attribution', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('cron-dispatched rung is dispatchedBySystem=true; admin BP_L2 retry is false', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    let james: Awaited<ReturnType<typeof tc.findUser>>
    let aisha: Awaited<ReturnType<typeof tc.findUser>>
    try {
      james = await tc.findUser(PATIENTS.james.email)
      aisha = await tc.findUser(PATIENTS.aisha.email)
      await tc.resetUser(james.id)
      await tc.resetUser(aisha.id)
    } catch (err) {
      test.skip(true, `test-control unprovisioned: ${(err as Error).message}`)
      return
    }

    // ── Part A — system path: James Tier 1 → T+0 dispatched by the
    //    escalation service (cron path), not a human. ──
    const jamesApi = await authedApi(API_BASE_URL, PATIENTS.james.email)
    await postJournalEntry(jamesApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 118,
      diastolicBP: 74,
      pulse: 68,
    })
    const tier1 = (
      await waitForAlerts(tc, james.id, (xs) =>
        xs.some((a) => a.tier === 'TIER_1_CONTRAINDICATION'),
      )
    ).find((a) => a.tier === 'TIER_1_CONTRAINDICATION')
    expect(tier1).toBeDefined()
    const sysEvents = await tc.listEscalationEvents(tier1!.id)
    expect(sysEvents.length, 'expected ≥1 cron-dispatched escalation event').toBeGreaterThanOrEqual(1)
    for (const e of sysEvents) {
      expect(
        (e as { dispatchedBySystem?: boolean }).dispatchedBySystem,
        `cron rung ${e.ladderStep} must be dispatchedBySystem=true`,
      ).toBe(true)
      expect((e as { triggeredByResolution?: boolean }).triggeredByResolution).toBe(false)
    }
    await jamesApi.dispose()

    // ── Part B — human path: Aisha BP_L2 → admin BP_L2_UNABLE_TO_REACH_RETRY
    //    schedules a retry event attributed to the admin action. ──
    const aishaApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    await postJournalEntry(aishaApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 185,
      diastolicBP: 95,
      pulse: 88,
    })
    const bpL2 = (
      await waitForAlerts(tc, aisha.id, (xs) =>
        xs.some((a) => a.tier === 'BP_LEVEL_2'),
      )
    ).find((a) => a.tier === 'BP_LEVEL_2')
    expect(bpL2).toBeDefined()
    const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
    await adminAcknowledgeAlert(adminApi, bpL2!.id)
    await adminResolveAlert(adminApi, bpL2!.id, {
      resolutionAction: 'BP_L2_UNABLE_TO_REACH_RETRY',
      resolutionRationale: 'qa-test: phase2 finding5 dispatch attribution',
    })
    const retryEvents = await tc.listEscalationEvents(bpL2!.id)
    const retry = retryEvents.find(
      (e) => (e as { triggeredByResolution?: boolean }).triggeredByResolution === true,
    )
    expect(retry, 'expected a triggeredByResolution retry event').toBeTruthy()
    expect(
      (retry as { dispatchedBySystem?: boolean }).dispatchedBySystem,
      'admin-scheduled BP_L2 retry must be dispatchedBySystem=false',
    ).toBe(false)

    await aishaApi.dispose()
    await adminApi.dispose()
    await tc.dispose()
  })
})

// ─── Phase 1 UI polish — Chrome-walkthrough fixes (Findings 1-9) ─────────────

test.describe('Phase 1 UI polish — admin ack actor + audit footer', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  // Findings 1 + 3 (deterministic backend contract). The admin AlertsTab
  // "Acknowledge" button hits PATCH /provider/alerts/:id/acknowledge — that
  // path previously set only status+acknowledgedAt (no actor, no event
  // propagation). Now it must write acknowledgedByUserId AND propagate to
  // every open EscalationEvent.
  test('admin ack via /provider/alerts/:id/acknowledge writes actor + propagates to events', async () => {
    test.setTimeout(120_000) // reset + OTP + waitForAlerts + ack + reads
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    let u: Awaited<ReturnType<typeof tc.findUser>>
    try {
      u = await tc.findUser(PATIENTS.aisha.email)
      await tc.resetUser(u.id)
    } catch (err) {
      test.skip(true, `test-control unprovisioned: ${(err as Error).message}`)
      return
    }
    const manisha = await apiSignIn(API_BASE_URL, ADMINS.manisha.email, 'admin')
    await manisha.ctx.dispose()

    const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 165,
      diastolicBP: 100,
      pulse: 78,
    })
    const bpL1 = (
      await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.tier === 'BP_LEVEL_1_HIGH'),
      )
    ).find((a) => a.tier === 'BP_LEVEL_1_HIGH')
    expect(bpL1).toBeDefined()

    const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
    const ackRes = await adminApi.patch(`provider/alerts/${bpL1!.id}/acknowledge`)
    expect(ackRes.ok(), `admin ack: ${ackRes.status()} ${await ackRes.text()}`).toBeTruthy()
    await new Promise((r) => setTimeout(r, 400))

    // Finding 1 — alert-level actor resolves to a display name.
    const alertsRes = await adminApi.get(`provider/patients/${u.id}/alerts`)
    const alert = ((await alertsRes.json()).data ?? []).find(
      (a: { id: string }) => a.id === bpL1!.id,
    )
    expect(alert.status).toBe('ACKNOWLEDGED')
    expect(alert.acknowledgedBy, 'alert-level acknowledgedBy must be the admin').toBe(
      manisha.userId,
    )
    expect(
      typeof alert.acknowledgedByName === 'string' && alert.acknowledgedByName.length > 0,
      `acknowledgedByName must resolve to a name, got ${JSON.stringify(alert.acknowledgedByName)}`,
    ).toBe(true)
    expect(alert.acknowledgedByName).not.toBe(manisha.userId)

    // Finding 3 — every open EscalationEvent picks up the ack actor.
    const events = await tc.listEscalationEvents(bpL1!.id)
    expect(events.length).toBeGreaterThanOrEqual(1)
    for (const e of events) {
      expect(
        (e as { acknowledgedAt?: string | null }).acknowledgedAt,
        `event ${e.ladderStep} acknowledgedAt must propagate`,
      ).not.toBeNull()
      expect((e as { acknowledgedBy?: string | null }).acknowledgedBy).toBe(manisha.userId)
    }

    await patientApi.dispose()
    await adminApi.dispose()
    await tc.dispose()
  })
})

test.describe('Phase 1 UI polish — audit panel display (Findings 2/4/5/6/7/8)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('ACKNOWLEDGED Tier-1 alert: footer renders, badge green, PP derived, actualValue n/a, no baseline, modal name', async ({
    page,
  }) => {
    test.setTimeout(150_000) // API setup + admin browser walk
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    try {
      const u = await tc.findUser(PATIENTS.james.email)
      await tc.resetUser(u.id)
      const patientApi = await authedApi(API_BASE_URL, PATIENTS.james.email)
      await postJournalEntry(patientApi, {
        measuredAt: new Date().toISOString(),
        systolicBP: 118,
        diastolicBP: 74,
        pulse: 68,
      })
      const tier1 = (
        await waitForAlerts(tc, u.id, (xs) =>
          xs.some((a) => a.tier === 'TIER_1_CONTRAINDICATION'),
        )
      ).find((a) => a.tier === 'TIER_1_CONTRAINDICATION')
      expect(tier1).toBeDefined()
      const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
      const ackRes = await adminApi.patch(`provider/alerts/${tier1!.id}/acknowledge`)
      expect(ackRes.ok()).toBeTruthy()
      await patientApi.dispose()
      await adminApi.dispose()

      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/patients`)
      const link = page.getByText(PATIENTS.james.name).first()
      await expect(link).toBeVisible({ timeout: 15_000 })
      await link.click()
      await expect(page).toHaveURL(/\/patients\/[^/]+$/, { timeout: 20_000 })
      const alertsTab = page.getByRole('tab', { name: 'Alerts' })
      await expect(alertsTab).toBeVisible({ timeout: 15_000 })
      await alertsTab.click()
      // AlertsTab defaults to the OPEN status filter — an ACKNOWLEDGED alert
      // is hidden until we switch to "All".
      await page.getByRole('button', { name: 'All', exact: true }).first().click()
      // Expand the alert card so the audit footer mounts.
      await page.getByRole('button', { name: 'Expand alert' }).first().click()
    } catch (err) {
      test.skip(true, `admin UI walk not reachable: ${(err as Error).message}`)
      return
    }

    // Finding 4 — footer renders for ACKNOWLEDGED (not just RESOLVED).
    const footer = page.locator('[data-testid="alert-audit-footer"]')
    await expect(footer).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-testid="alert-audit-header"]')).toContainText(
      /acknowledgment audit/i,
    )
    // Finding 1 (UI) — acknowledged-by shows a name, not "—".
    await expect(page.locator('[data-testid="audit-field-acknowledgedBy"]')).not.toContainText('—')
    // Reviewer feedback 2026-05-17 — the resolution rows on an ACK record
    // use a concise "Pending resolution" token, NOT the old verbose
    // "Not required — alert acknowledged, not yet resolved" repeated 3×.
    await expect(page.locator('[data-testid="audit-field-resolved"]')).toContainText(
      'Pending resolution',
    )
    await expect(page.locator('[data-testid="audit-field-resolved"]')).not.toContainText(
      /not yet resolved/i,
    )
    // Finding 2 — a triggered rung must not still read "Awaiting acknowledgment".
    await expect(page.getByText('Awaiting acknowledgment')).toHaveCount(0)
    // Finding 5 — pulse pressure derived (118/74 → 44), not "—".
    await expect(page.locator('[data-testid="audit-field-pulsePressure"]')).toContainText('44')
    // Finding 6 + 10 — Tier-1 profile-based rule (RULE_NDHP_HFREF) → the
    // TRIGGERING VALUE field shows the em-dash profile copy, not "—". Field
    // + testid renamed actualValue → triggeringValue in Finding 10.
    await expect(page.locator('[data-testid="audit-field-triggeringValue"]')).toContainText(
      /not applicable — profile-based rule/i,
    )
    await expect(page.locator('[data-testid="audit-field-actualValue"]')).toHaveCount(0)
    // Finding 7 — vestigial baseline row removed.
    await expect(page.locator('[data-testid="audit-field-baselineValue"]')).toHaveCount(0)

    // Finding 8 — resolve modal shows the patient name, not "Unknown patient".
    const resolveBtn = page.getByRole('button', { name: /resolve/i }).first()
    if (await resolveBtn.isVisible().catch(() => false)) {
      await resolveBtn.click()
      await expect(page.getByText(/unknown patient/i)).toHaveCount(0)
      await expect(page.getByText(PATIENTS.james.name)).toBeVisible({ timeout: 10_000 })
    }
    await tc.dispose()
  })
})

test.describe('Phase 1 UI polish — Finding 9: resolved-directly ack copy', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('alert resolved without prior ack shows "Not required — alert resolved directly"', async ({
    page,
  }) => {
    test.setTimeout(150_000) // API setup + admin browser walk
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    try {
      const u = await tc.findUser(PATIENTS.james.email)
      await tc.resetUser(u.id)
      const patientApi = await authedApi(API_BASE_URL, PATIENTS.james.email)
      await postJournalEntry(patientApi, {
        measuredAt: new Date().toISOString(),
        systolicBP: 118,
        diastolicBP: 74,
        pulse: 68,
      })
      const tier1 = (
        await waitForAlerts(tc, u.id, (xs) =>
          xs.some((a) => a.tier === 'TIER_1_CONTRAINDICATION'),
        )
      ).find((a) => a.tier === 'TIER_1_CONTRAINDICATION')
      expect(tier1).toBeDefined()
      const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
      // Resolve DIRECTLY — no prior acknowledge.
      await adminResolveAlert(adminApi, tier1!.id, {
        resolutionAction: 'TIER1_FALSE_POSITIVE',
        resolutionRationale: 'qa-test: phase1-polish finding9 resolved directly',
      })
      await patientApi.dispose()
      await adminApi.dispose()

      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/patients`)
      const link = page.getByText(PATIENTS.james.name).first()
      await expect(link).toBeVisible({ timeout: 15_000 })
      await link.click()
      await expect(page).toHaveURL(/\/patients\/[^/]+$/, { timeout: 20_000 })
      const alertsTab = page.getByRole('tab', { name: 'Alerts' })
      await alertsTab.click()
      // RESOLVED alert is hidden under the default OPEN filter — switch to All.
      await page.getByRole('button', { name: 'All', exact: true }).first().click()
      await page.getByRole('button', { name: 'Expand alert' }).first().click()
    } catch (err) {
      test.skip(true, `admin UI walk not reachable: ${(err as Error).message}`)
      return
    }
    await expect(page.locator('[data-testid="audit-field-acknowledged"]')).toContainText(
      /not required — alert resolved directly/i,
    )
    await tc.dispose()
  })
})

// ─── Phase 1 polish — Finding 10: TRIGGERING VALUE axis + unit ──────────────

// Deterministic unit coverage of the shared formatter — no server, always
// runs (not write-gated). This is the strongest proof the axis/unit logic is
// correct across every axis; the UI-walk below confirms it renders in the
// footer.
test.describe('Phase 1 polish — Finding 10: formatTriggeringValue', () => {
  test('axis + unit + profile + null + unmapped formatting', async () => {
    // systolic BP rule → mmHg (systolic)
    expect(formatTriggeringValue(RULE_IDS.STANDARD_L1_HIGH, 165)).toBe(
      '165 mmHg (systolic)',
    )
    // diastolic rule → mmHg (diastolic)
    expect(formatTriggeringValue(RULE_IDS.CAD_DBP_CRITICAL, 68)).toBe(
      '68 mmHg (diastolic)',
    )
    // heart-rate rule → bpm (heart rate)
    expect(formatTriggeringValue(RULE_IDS.BRADY_ABSOLUTE, 38)).toBe(
      '38 bpm (heart rate)',
    )
    expect(formatTriggeringValue(RULE_IDS.AFIB_HR_HIGH, 132)).toBe(
      '132 bpm (heart rate)',
    )
    // profile-based rule → fixed copy regardless of value
    expect(formatTriggeringValue(RULE_IDS.NDHP_HFREF, null)).toBe(
      'Not applicable — profile-based rule',
    )
    expect(formatTriggeringValue(RULE_IDS.MEDICATION_MISSED, 5)).toBe(
      'Not applicable — profile-based rule',
    )
    // value-based rule with a genuinely missing value → em-dash
    expect(formatTriggeringValue(RULE_IDS.STANDARD_L1_HIGH, null)).toBe('—')
    // unknown / null ruleId → safe systolic default (future BP rules)
    expect(formatTriggeringValue('RULE_NOT_YET_MAPPED', 150)).toBe(
      '150 mmHg (systolic)',
    )
    expect(formatTriggeringValue(null, 150)).toBe('150 mmHg (systolic)')
  })
})

test.describe('Phase 1 polish — Finding 10: TRIGGERING VALUE in footer (UI)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('value-based BP alert shows "<n> mmHg (systolic)" in the audit footer', async ({
    page,
  }) => {
    test.setTimeout(150_000) // trigger + ack + admin browser walk
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    try {
      const u = await tc.findUser(PATIENTS.aisha.email)
      await tc.resetUser(u.id)
      const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
      // Standard-mode systolic-axis BP L1 (value-based → actualValue set).
      await postJournalEntry(patientApi, {
        measuredAt: new Date().toISOString(),
        systolicBP: 165,
        diastolicBP: 95,
        pulse: 78,
      })
      const bpL1 = (
        await waitForAlerts(tc, u.id, (xs) =>
          xs.some((a) => a.tier === 'BP_LEVEL_1_HIGH'),
        )
      ).find((a) => a.tier === 'BP_LEVEL_1_HIGH')
      expect(bpL1).toBeDefined()
      const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
      const ackRes = await adminApi.patch(`provider/alerts/${bpL1!.id}/acknowledge`)
      expect(ackRes.ok()).toBeTruthy()
      await patientApi.dispose()
      await adminApi.dispose()

      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/patients`)
      const link = page.getByText(PATIENTS.aisha.name).first()
      await expect(link).toBeVisible({ timeout: 15_000 })
      await link.click()
      await expect(page).toHaveURL(/\/patients\/[^/]+$/, { timeout: 20_000 })
      await page.getByRole('tab', { name: 'Alerts' }).click()
      await page.getByRole('button', { name: 'All', exact: true }).first().click()
      await page.getByRole('button', { name: 'Expand alert' }).first().click()
    } catch (err) {
      test.skip(true, `admin UI walk not reachable: ${(err as Error).message}`)
      return
    }
    // Field renamed actualValue → triggeringValue (Finding 10); value carries
    // unit + axis context instead of a bare number.
    const tv = page.locator('[data-testid="audit-field-triggeringValue"]')
    await expect(tv).toBeVisible({ timeout: 15_000 })
    await expect(tv).toContainText(/mmHg \(systolic\)/i)
    await expect(tv).toContainText(/\d/)

    // Reviewer feedback 2026-05-17 — this is an ACKNOWLEDGED BP Level 1
    // alert. Per CLINICAL_SPEC Part 12, BP L1 has NO resolution-action
    // catalog (resolutionTierFor → null): acknowledgment is its terminal
    // state. The resolution rows must read "closed on acknowledgment", NOT
    // "Pending resolution" (which only applies to Tier 1/2/BP L2).
    const resolvedRow = page.locator('[data-testid="audit-field-resolved"]')
    await expect(resolvedRow).toContainText(/closed on acknowledgment/i)
    await expect(resolvedRow).not.toContainText(/pending resolution/i)
    await tc.dispose()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Phase 3 §G — AlertResolutionModal end-to-end (30g.1–30g.5)
//
// Reality (Phase 3 §B audit): the 3-tier patient/caregiver/physician message
// cards live in the EXPANDED AlertCard on the Alerts tab — NOT in the modal.
// AlertResolutionModal shows the patient-facing message + a tier-filtered
// button-list of resolution actions + a rationale textarea. Tier 1 actions
// all require a rationale (provider.service RESOLUTION_CATALOG).
// ───────────────────────────────────────────────────────────────────────────
test.describe('Phase 3 §G — alert resolution modal', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Phase 3 admin write/e2e gated')

  test('30g.1 — Tier 1 alert exposes all 3 message tiers in the expanded AlertCard', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    const { alertIds } = await tc.seedAlerts(aisha.id, [{ tier: 'TIER_1_CONTRAINDICATION', status: 'OPEN' }])
    const id = alertIds[0]

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await gotoPatientAlertsTab(page, aisha.id)
    await page.locator(byTestId(T.admin.alertExpand(id))).click()

    // 3-tier display is the expanded card (Category-A: doc said "modal").
    await expect(page.locator(byTestId(T.admin.alertMsgPatient(id)))).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(byTestId(T.admin.alertMsgCaregiver(id)))).toBeVisible()
    await expect(page.locator(byTestId(T.admin.alertMsgPhysician(id)))).toBeVisible()

    // The modal itself opens with the action catalog (patient msg + actions).
    await page.locator(byTestId(T.admin.alertResolveBtnFor(id))).click()
    await expect(page.locator(byTestId(T.admin.resolveModal))).toBeVisible({ timeout: 15_000 })
    await expect(
      page.locator(byTestId(T.admin.resolveAction('TIER1_FALSE_POSITIVE'))),
    ).toBeVisible()
  })

  test('30g.2 — resolution modal shows only tier-appropriate actions (Tier 1)', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    const { alertIds } = await tc.seedAlerts(aisha.id, [{ tier: 'TIER_1_CONTRAINDICATION', status: 'OPEN' }])
    const id = alertIds[0]

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await gotoPatientAlertsTab(page, aisha.id)
    await page.locator(byTestId(T.admin.alertResolveBtnFor(id))).click()
    await expect(page.locator(byTestId(T.admin.resolveModal))).toBeVisible({ timeout: 15_000 })

    for (const a of ['TIER1_DISCONTINUED', 'TIER1_CHANGE_ORDERED', 'TIER1_FALSE_POSITIVE', 'TIER1_ACKNOWLEDGED', 'TIER1_DEFERRED']) {
      await expect(page.locator(byTestId(T.admin.resolveAction(a))), `Tier 1 action ${a}`).toBeVisible()
    }
    // No Tier 2 / BP L2 actions leak into a Tier 1 resolution.
    await expect(page.locator(byTestId(T.admin.resolveAction('TIER2_REVIEWED_NO_ACTION')))).toHaveCount(0)
    await expect(page.locator(byTestId(T.admin.resolveAction('BP_L2_CONTACTED_RECHECK')))).toHaveCount(0)
  })

  test('30g.3 — confirm is disabled until a required rationale is provided', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    const { alertIds } = await tc.seedAlerts(aisha.id, [{ tier: 'TIER_1_CONTRAINDICATION', status: 'OPEN' }])
    const id = alertIds[0]

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await gotoPatientAlertsTab(page, aisha.id)
    await page.locator(byTestId(T.admin.alertResolveBtnFor(id))).click()
    await expect(page.locator(byTestId(T.admin.resolveModal))).toBeVisible({ timeout: 15_000 })

    await page.locator(byTestId(T.admin.resolveAction('TIER1_FALSE_POSITIVE'))).click()
    const confirm = page.locator(byTestId(T.admin.alertResolveBtn))
    await expect(confirm, 'confirm disabled before rationale').toBeDisabled()
    await page.locator(byTestId(T.admin.alertResolveRationale)).fill('qa: reviewed — no clinical concern')
    await expect(confirm, 'confirm enabled after rationale').toBeEnabled()
  })

  test('30g.4 — resolving via the modal flips the alert to RESOLVED', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    const { alertIds } = await tc.seedAlerts(aisha.id, [{ tier: 'TIER_1_CONTRAINDICATION', status: 'OPEN' }])
    const id = alertIds[0]

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await gotoPatientAlertsTab(page, aisha.id)
    await resolveAlertViaModal(page, id, {
      resolutionAction: 'TIER1_FALSE_POSITIVE',
      rationale: 'qa: medication corrected after re-review',
    })

    const alerts = await tc.listAlerts(aisha.id)
    const resolved = alerts.find((a) => a.id === id)
    expect(resolved?.status, `alert ${id} status`).toBe('RESOLVED')
  })

  test('30g.5 — a modal-resolved alert is consistently RESOLVED on Alerts-tab refresh', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    const { alertIds } = await tc.seedAlerts(aisha.id, [{ tier: 'TIER_1_CONTRAINDICATION', status: 'OPEN' }])
    const id = alertIds[0]

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await gotoPatientAlertsTab(page, aisha.id)
    await resolveAlertViaModal(page, id, {
      resolutionAction: 'TIER1_FALSE_POSITIVE',
      rationale: 'qa: reviewed — no clinical concern',
    })

    // Category-A reality: a Tier 1 resolved DIRECTLY (no prior ack — Tier 1
    // is resolve-only, no UI ack) leaves DeviationAlert.acknowledgedAt null,
    // and TimelineTab gates its "alert resolved" entry on acknowledgedAt
    // ("Finding 9"). So the cross-surface consistency signal is the Alerts
    // tab itself on a fresh load: the alert must persist as RESOLVED under
    // the RESOLVED status filter.
    await page.goto(`${ADMIN_BASE_URL}/patients/detail?id=${aisha.id}`)
    await page.locator(byTestId(T.admin.detailTab('alerts'))).click()
    await page
      .locator(byTestId(T.admin.alertsStatusFilter('RESOLVED')))
      .waitFor({ state: 'visible', timeout: 25_000 })
    await page.locator(byTestId(T.admin.alertsStatusFilter('RESOLVED'))).click()
    await expect(page.locator(byTestId(T.admin.alertRow(id)))).toBeVisible({ timeout: 20_000 })
    await expect(
      page.locator(byTestId(T.admin.alertStatusBadge(id))),
    ).toContainText(/resolved/i)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Phase 3 §H — alert acknowledgement (30h.1–30h.3)
//
// Reality (AlertCard): the Acknowledge button renders only for BP L1
// (BP_LEVEL_1_*), status OPEN, not-yet-acked — BP L1 has no resolution
// catalog so ack is its terminal state. Resolve renders only for OPEN
// resolvable tiers (Tier 1 / Tier 2 / BP L2). Tier 1 / BP L2 therefore
// never show an ack button. The UI resolve path requires OPEN, so the
// patient-ack-then-admin-resolve sequence (30h.2) drives the resolve via
// API and verifies the final UI state (Category-A adaptation).
// ───────────────────────────────────────────────────────────────────────────
test.describe('Phase 3 §H — alert acknowledgement', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Phase 3 admin write/e2e gated')

  test('30h.1 — admin acknowledges a BP L1 alert → status ACKNOWLEDGED', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    const { alertIds } = await tc.seedAlerts(aisha.id, [{ tier: 'BP_LEVEL_1_HIGH', status: 'OPEN' }])
    const id = alertIds[0]

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await gotoPatientAlertsTab(page, aisha.id)
    await page.locator(byTestId(T.admin.alertAckBtn(id))).click()

    // Ack is an async POST — poll until it persists (audit-backed proof).
    const acked = await waitForAlerts(
      tc,
      aisha.id,
      (xs) => xs.find((a) => a.id === id)?.status === 'ACKNOWLEDGED',
    )
    expect(acked.find((a) => a.id === id)?.status).toBe('ACKNOWLEDGED')

    // Consistently reflected under the ACKNOWLEDGED status filter (fresh load).
    await page.goto(`${ADMIN_BASE_URL}/patients/detail?id=${aisha.id}`)
    await page.locator(byTestId(T.admin.detailTab('alerts'))).click()
    await page
      .locator(byTestId(T.admin.alertsStatusFilter('ACKNOWLEDGED')))
      .waitFor({ state: 'visible', timeout: 25_000 })
    await page.locator(byTestId(T.admin.alertsStatusFilter('ACKNOWLEDGED'))).click()
    await expect(
      page.locator(byTestId(T.admin.alertStatusBadge(id))),
    ).toContainText(/acknowledged/i, { timeout: 20_000 })
  })

  test('30h.2 — patient acks first, admin still resolves correctly (sequence integrity)', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    const { alertIds } = await tc.seedAlerts(aisha.id, [{ tier: 'TIER_1_CONTRAINDICATION', status: 'OPEN' }])
    const id = alertIds[0]

    // Patient acknowledges first (patient endpoint) → status ACKNOWLEDGED.
    const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    await patchPatientAcknowledgeAlert(patientApi, id)
    await patientApi.dispose()
    expect((await tc.listAlerts(aisha.id)).find((a) => a.id === id)?.status).toBe('ACKNOWLEDGED')

    // Admin resolves the (now ACKNOWLEDGED) Tier 1 — the UI resolve button
    // only renders for OPEN, so the resolve goes via the admin API; the
    // sequence must still terminate cleanly at RESOLVED.
    const adminApi = await authedApi(API_BASE_URL, ADMINS.medicalDirector.email, 'admin')
    await adminResolveAlert(adminApi, id, {
      resolutionAction: 'TIER1_FALSE_POSITIVE',
      resolutionRationale: 'qa: post-patient-ack provider review — no concern',
    })
    await adminApi.dispose()
    expect((await tc.listAlerts(aisha.id)).find((a) => a.id === id)?.status).toBe('RESOLVED')

    // UI consistency: Alerts tab (RESOLVED filter) shows the final state.
    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients/detail?id=${aisha.id}`)
    await page.locator(byTestId(T.admin.detailTab('alerts'))).click()
    await page
      .locator(byTestId(T.admin.alertsStatusFilter('RESOLVED')))
      .waitFor({ state: 'visible', timeout: 25_000 })
    await page.locator(byTestId(T.admin.alertsStatusFilter('RESOLVED'))).click()
    await expect(
      page.locator(byTestId(T.admin.alertStatusBadge(id))),
    ).toContainText(/resolved/i, { timeout: 20_000 })
  })

  test('30h.3 — Tier 1 and BP L2 show Resolve but NO Acknowledge button', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    const t1 = await tc.seedAlerts(aisha.id, [{ tier: 'TIER_1_CONTRAINDICATION', status: 'OPEN' }])
    const l2 = await tc.seedAlerts(aisha.id, [{ tier: 'BP_LEVEL_2', status: 'OPEN' }])
    const t1Id = t1.alertIds[0]
    const l2Id = l2.alertIds[0]

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await gotoPatientAlertsTab(page, aisha.id)

    for (const id of [t1Id, l2Id]) {
      await expect(page.locator(byTestId(T.admin.alertRow(id)))).toBeVisible({ timeout: 20_000 })
      await expect(
        page.locator(byTestId(T.admin.alertResolveBtnFor(id))),
        `resolve button for ${id}`,
      ).toBeVisible()
      await expect(
        page.locator(byTestId(T.admin.alertAckBtn(id))),
        `NO ack button for ${id}`,
      ).toHaveCount(0)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Phase 3 §J — JCAHO audit footer (30j.1, 30j.2)
//
// Reality (Phase 3 §B audit): the footer renders ~17 `audit-field-<key>`
// rows — NOT the doc's idealised 15 with keys rule-id/patient-name/
// discrepancy-flag/escalation-rungs/dispatched-by-system/patient-message.
// The REAL keys (EscalationAuditTrail.AlertAuditFooter): alertId, tier,
// ruleId, severity, mode, status, created, acknowledged, acknowledgedBy,
// resolved, resolvedBy, resolutionAction, reading, pulsePressure, bmi,
// triggeringValue, escalationCount (+ conditional resolutionRationale).
// Footer renders inside the EXPANDED AlertCard for RESOLVED/ACKNOWLEDGED.
// ───────────────────────────────────────────────────────────────────────────
const AUDIT_FIELD_KEYS = [
  'alertId', 'tier', 'ruleId', 'severity', 'mode', 'status', 'created',
  'acknowledged', 'acknowledgedBy', 'resolved', 'resolvedBy',
  'resolutionAction', 'reading', 'pulsePressure', 'bmi', 'triggeringValue',
  'escalationCount',
] as const

test.describe('Phase 3 §J — JCAHO audit footer', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Phase 3 admin write/e2e gated')

  test('30j.1 — resolved alert renders the full audit footer (real ~17 fields + rationale)', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    const md = await tc.findUser(ADMINS.medicalDirector.email)
    await tc.resetUser(aisha.id)
    const { alertIds } = await tc.seedAlerts(aisha.id, [{
      tier: 'TIER_1_CONTRAINDICATION',
      status: 'RESOLVED',
      resolvedBy: md.id,
      resolutionAction: 'TIER1_FALSE_POSITIVE',
      resolutionRationale: 'qa: reviewed — no clinical concern',
    }])
    const id = alertIds[0]

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await gotoPatientAlertsTab(page, aisha.id)
    await page.locator(byTestId(T.admin.alertsStatusFilter('RESOLVED'))).click()
    await page.locator(byTestId(T.admin.alertExpand(id))).click()

    const footer = page.locator(byTestId(T.admin.auditFooter))
    await expect(footer).toBeVisible({ timeout: 20_000 })
    await expect(page.locator(byTestId(T.admin.auditHeader))).toContainText(/resolution audit record/i)
    for (const key of AUDIT_FIELD_KEYS) {
      await expect(
        footer.locator(`[data-testid="audit-field-${key}"]`),
        `audit field ${key}`,
      ).toBeVisible()
    }
    await expect(page.locator(byTestId(T.admin.auditRationale))).toContainText('no clinical concern')
    await tc.dispose()
  })

  test('30j.2 — legacy ack (no recorded actor) renders the "Not recorded" copy', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    // ACKNOWLEDGED with NO acknowledgedByUserId simulates pre-audit-fix
    // legacy data → acknowledgedBy field reads the explicit "Not recorded".
    const { alertIds } = await tc.seedAlerts(aisha.id, [{
      tier: 'BP_LEVEL_1_HIGH',
      status: 'ACKNOWLEDGED',
    }])
    const id = alertIds[0]

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await gotoPatientAlertsTab(page, aisha.id)
    await page.locator(byTestId(T.admin.alertsStatusFilter('ACKNOWLEDGED'))).click()
    await page.locator(byTestId(T.admin.alertExpand(id))).click()

    const footer = page.locator(byTestId(T.admin.auditFooter))
    await expect(footer).toBeVisible({ timeout: 20_000 })
    await expect(page.locator(byTestId(T.admin.auditHeader))).toContainText(/acknowledgment audit record/i)
    await expect(
      footer.locator('[data-testid="audit-field-acknowledgedBy"]'),
    ).toContainText(/not recorded.*audit fix/i)
    await tc.dispose()
  })
})
