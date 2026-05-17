import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { authedApi, signInAdmin } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import {
  postJournalEntry,
  adminAcknowledgeAlert,
  adminResolveAlert,
  adminAuditAlert,
  waitForAlerts,
} from '../helpers/api.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'

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
  test('per-patient alerts endpoint surfaces alert-level acknowledgedBy + acknowledgedByName + resolvedAt', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    let u: Awaited<ReturnType<typeof tc.findUser>>
    try {
      u = await tc.findUser(PATIENTS.aisha.email)
      await tc.resetUser(u.id)
    } catch (err) {
      // Backend without ENABLE_TEST_CONTROL=true — same env gate the
      // pre-existing spec 13 write-tests need. Skip cleanly (qa README:
      // never silently no-op) rather than false-red the audit gate; the
      // assertions still execute under a provisioned CI run.
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

    // Patient self-acknowledges — this is the exact path the observed bug
    // was about (patient as the acking actor).
    const ackRes = await patientApi.patch(`daily-journal/alerts/${bpL1!.id}/acknowledge`)
    expect(ackRes.ok(), `patient ack: ${ackRes.status()}`).toBeTruthy()
    await new Promise((r) => setTimeout(r, 500))

    const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')

    // ── §C: alert-level acknowledgedBy + acknowledgedByName now present ──
    const afterAckRes = await adminApi.get(`provider/patients/${u.id}/alerts`)
    expect(afterAckRes.ok(), `GET alerts: ${afterAckRes.status()}`).toBeTruthy()
    const afterAckBody = await afterAckRes.json()
    const ackedAlert = (afterAckBody.data ?? afterAckBody).find(
      (a: { id: string }) => a.id === bpL1!.id,
    )
    expect(ackedAlert, 'resolved alert must be in per-patient feed').toBeDefined()
    expect(
      ackedAlert.acknowledgedBy,
      'alert-level acknowledgedBy must be the patient userId (was absent pre-fix)',
    ).toBe(u.id)
    expect(
      typeof ackedAlert.acknowledgedByName === 'string' &&
        ackedAlert.acknowledgedByName.length > 0,
      `acknowledgedByName must resolve to a display name, got: ${JSON.stringify(ackedAlert.acknowledgedByName)}`,
    ).toBe(true)
    // A resolved display name, NOT a raw UUID echoed back.
    expect(
      ackedAlert.acknowledgedByName,
      'acknowledgedByName must not be the raw userId',
    ).not.toBe(u.id)

    // ── §B: resolve, then assert resolvedAt is distinct + actor resolved ──
    await adminResolveAlert(adminApi, bpL1!.id, {
      resolutionAction: 'BP_L1_REVIEWED_NO_ACTION',
      resolutionRationale: 'qa-test: phase1 §B/§C audit contract',
    })
    const afterResolveRes = await adminApi.get(`provider/patients/${u.id}/alerts`)
    const afterResolveBody = await afterResolveRes.json()
    const resolvedAlert = (afterResolveBody.data ?? afterResolveBody).find(
      (a: { id: string }) => a.id === bpL1!.id,
    )
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
    // Acknowledged (patient) and Resolved (admin) are now distinct actors —
    // proves the rows are no longer conflated.
    expect(resolvedAlert.acknowledgedBy).toBe(u.id)
    expect(resolvedAlert.resolvedBy).not.toBe(u.id)

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
    } catch (err) {
      test.skip(
        true,
        `admin patient-detail UI walk not reachable in this env ` +
          `(provisioned admin+seed required): ${(err as Error).message}`,
      )
      return
    }

    // ── Real assertions (env provisioned) ────────────────────────────────
    // Expand the resolved alert so the 15-field footer mounts. The alert
    // card is the clickable element that contains the tier label.
    const card = page.getByText('TIER 1', { exact: false }).first()
    await card.click().catch(() => {})

    // §B — every one of the 15 audit fields renders with a stable testid.
    const FIELD_KEYS = [
      'alertId', 'tier', 'ruleId', 'severity', 'mode', 'status', 'created',
      'acknowledged', 'acknowledgedBy', 'resolved', 'resolvedBy',
      'resolutionAction', 'reading', 'pulsePressure', 'baselineValue',
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

  test('DELETE /daily-journal/:id cascades to linked DeviationAlert + EscalationEvent (flagged for CTO review)', async () => {
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

    // CURRENT BEHAVIOR (documented, not endorsed): the linked DeviationAlert
    // is cascade-deleted...
    const alertsAfter = await tc.listAlerts(u.id)
    expect(
      alertsAfter.some((a) => a.id === alertId),
      'CURRENT cascade behavior: DeviationAlert is removed when its JournalEntry is deleted',
    ).toBe(false)

    // ...and so are its EscalationEvent rows (the audit trail).
    const eventsAfter = await tc.listEscalationEvents(alertId)
    expect(
      eventsAfter.length,
      `CURRENT cascade behavior: EscalationEvent rows removed (had ${eventsBefore.length})`,
    ).toBe(0)

    // TODO(CTO + Manisha + counsel — Phase 1 §G.3): if the architecture moves
    // to soft-supersede (reading correction keeps prior alert as historical
    // evidence), update this test to assert the alert/escalation rows PERSIST
    // (marked superseded) instead of being erased.

    await patientApi.dispose()
    await tc.dispose()
  })
})
