import { test, expect } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { postJournalEntry, waitForAlerts } from '../helpers/api.js'
import { MINUTES, HOURS } from '../helpers/time.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Cluster 8 §C.2 / §C.4 — angioedema compressed escalation ladder via runScan.
 *
 * Static ladder shape is covered in backend/src/daily_journal/escalation/
 * ladder-defs.spec.ts (Cluster 8 §C.1, 11 cases). This spec drives the
 * runtime end-to-end so we know the cron + dispatch wiring actually walks
 * T+0 → T+15m → T+1h → T+4h on a real angioedema alert, NOT the standard
 * T+0/T+4h/T+8h Tier 1 cadence (cross-wiring guard at the runtime layer).
 *
 * Strategy mirrors spec 14 (Tier 1 ladder):
 *   1. Trigger TIER_1_ANGIOEDEMA by submitting Aisha + faceSwelling
 *      (ACE inhibitor seeded via test-control, no AFib gate to clear since
 *      angioedema is Stage A pre-gate — fires on a SINGLE reading)
 *   2. runScan(now) — fires the queued T+0 (FIRE_IMMEDIATELY behavior means
 *      T+0 fires regardless of business hours)
 *   3. backdateAlertAnchor by 16 minutes → runScan → assert T+15M dispatches
 *      (NOT T+4H — that's the cross-wiring regression we're guarding)
 *   4. backdateAlertAnchor by 65 minutes → runScan → T+1H fires
 *   5. backdateAlertAnchor by 4h05m → runScan → T+4H fires
 *
 * §J deferral: CAREGIVER dispatch path is gated behind
 * CAREGIVER_DISPATCH_ENABLED until Lakshitha Gap 5 ships the PatientCaregiver
 * relation. §C.4 asserts NO caregiver EscalationEvent exists at T+0; we are
 * NOT testing that it dispatches.
 */

async function seedHistoryToClearPreDay3(
  tc: Awaited<ReturnType<typeof newTestControl>>,
  userId: string,
): Promise<void> {
  const now = Date.now()
  const readings = Array.from({ length: 8 }).map((_, i) => ({
    measuredAt: new Date(now - (i + 1) * 24 * 60 * 60 * 1000).toISOString(),
    systolicBP: 120,
    diastolicBP: 78,
    pulse: 72,
    sessionId: crypto.randomUUID(),
  }))
  await tc.seedReadingsAtTime(userId, readings)
}

test.describe('Cluster 8 §C — angioedema compressed-ladder runtime', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (mutates seed-patient journal entries)',
  )

  test('§C.2 — full compressed ladder T+0 → T+15m → T+1h → T+4h (via runScan)', async () => {
    // Cloud-DB latency: this test does ~10 sequential test-control roundtrips
    // (seed history, set med, post entry, wait for alert, then 4 scans + 3
    // backdates + 4 listEscalationEvents). The default 30s budget is tight;
    // give it 120s so a flaky network burst doesn't false-fail. Local Postgres
    // (pgvector container, Phase 4 §F) would not need this.
    test.setTimeout(120_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    // Verified ACE on the med list so the rule resolves to RULE_ACE_ANGIOEDEMA
    // (compressed-ladder routing is the same for ACE/ARB/GENERIC since they
    // all carry TIER_1_ANGIOEDEMA; we use ACE for the most realistic case).
    await tc.setUserMedication(u.id, {
      drugName: 'Lisinopril',
      drugClass: 'ACE_INHIBITOR',
      frequency: 'ONCE_DAILY',
      verificationStatus: 'VERIFIED',
    })

    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await postJournalEntry(api, {
        measuredAt: new Date().toISOString(),
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
        faceSwelling: true,
        sessionId: crypto.randomUUID(),
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.tier === 'TIER_1_ANGIOEDEMA'),
      )
      const ae = alerts.find((a) => a.tier === 'TIER_1_ANGIOEDEMA')
      expect(ae, 'TIER_1_ANGIOEDEMA alert should exist after faceSwelling').toBeDefined()

      // T+0 — runScan once to be sure the queued T+0 dispatches.
      await tc.runEscalationScan(new Date())
      let events = await tc.listEscalationEvents(ae!.id)
      expect(
        events.some((e) => e.ladderStep === 'T0'),
        `expected T0 EscalationEvent; got [${events.map((e) => e.ladderStep).join(',')}]`,
      ).toBeTruthy()

      // T+15m — backdate anchor by 16m, scan, assert T15M dispatches.
      // Critical: would FAIL if angioedema was wired to the standard Tier 1
      // ladder (the next standard rung is T4H, not T15M).
      await tc.backdateAlertAnchor(ae!.id, 16 * 60)
      await tc.runEscalationScan(new Date())
      events = await tc.listEscalationEvents(ae!.id)
      expect(
        events.some((e) => e.ladderStep === 'T15M'),
        `expected T15M after 16m backdate; got [${events.map((e) => e.ladderStep).join(',')}]`,
      ).toBeTruthy()
      const t15m = events.find((e) => e.ladderStep === 'T15M')
      // Per ladder-defs: T15M dispatches to BACKUP_PROVIDER (compressed ladder
      // doesn't wait until T+4h to alert backup, unlike standard Tier 1).
      expect(t15m?.recipientRoles).toContain('BACKUP_PROVIDER')

      // T+1h — backdate to 65m past, scan, assert T1H dispatches.
      await tc.backdateAlertAnchor(ae!.id, 65 * 60)
      await tc.runEscalationScan(new Date())
      events = await tc.listEscalationEvents(ae!.id)
      expect(
        events.some((e) => e.ladderStep === 'T1H'),
        `expected T1H after 65m backdate; got [${events.map((e) => e.ladderStep).join(',')}]`,
      ).toBeTruthy()
      const t1h = events.find((e) => e.ladderStep === 'T1H')
      // T+1h is the medical-director + ops co-fire (compressed ladder).
      const t1hRecipients = new Set(t1h?.recipientRoles ?? [])
      expect(t1hRecipients.has('MEDICAL_DIRECTOR')).toBeTruthy()
      expect(t1hRecipients.has('HEALPLACE_OPS')).toBeTruthy()

      // T+4h — backdate to 4h05m past, scan, assert T4H dispatches.
      await tc.backdateAlertAnchor(ae!.id, 4 * 60 * 60 + 5 * 60)
      await tc.runEscalationScan(new Date())
      events = await tc.listEscalationEvents(ae!.id)
      expect(
        events.some((e) => e.ladderStep === 'T4H'),
        `expected T4H after 4h05m backdate; got [${events.map((e) => e.ladderStep).join(',')}]`,
      ).toBeTruthy()
      const t4h = events.find((e) => e.ladderStep === 'T4H')
      // T+4h is the ops-only rung in the compressed ladder (the MVP "auto
      // incident report" stand-in — the standalone incident-report record
      // is deferred post-pilot per Niva's 44713de note).
      expect(t4h?.recipientRoles).toEqual(['HEALPLACE_OPS'])

      // Sanity: NO T8H / T24H / T48H rung exists. Those belong to the
      // standard Tier 1 ladder ONLY; their presence here would mean the
      // engine cross-wired angioedema back onto the standard 4h/8h/24h cadence.
      for (const wrongStep of ['T8H', 'T24H', 'T48H']) {
        expect(
          events.some((e) => e.ladderStep === wrongStep),
          `compressed ladder must NOT have ${wrongStep} (standard-ladder rung)`,
        ).toBeFalsy()
      }
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('§C.4 — T+0 multi-dispatch: PRIMARY_PROVIDER + PATIENT fire; caregiver gated OFF', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    await tc.setUserMedication(u.id, {
      drugName: 'Lisinopril',
      drugClass: 'ACE_INHIBITOR',
      frequency: 'ONCE_DAILY',
      verificationStatus: 'VERIFIED',
    })

    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await postJournalEntry(api, {
        measuredAt: new Date().toISOString(),
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
        faceSwelling: true,
        sessionId: crypto.randomUUID(),
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.tier === 'TIER_1_ANGIOEDEMA'),
      )
      const ae = alerts.find((a) => a.tier === 'TIER_1_ANGIOEDEMA')!
      await tc.runEscalationScan(new Date())

      // Provider EscalationEvent at T+0.
      const events = await tc.listEscalationEvents(ae.id)
      const t0Provider = events.find(
        (e) => e.ladderStep === 'T0' && e.recipientRoles.includes('PRIMARY_PROVIDER'),
      )
      expect(t0Provider, 'PRIMARY_PROVIDER T0 EscalationEvent must exist').toBeDefined()

      // Patient T+0 row exists (ANGIOEDEMA_PATIENT_T0 — separate dispatch).
      // The engine writes a Notification row carrying the registry
      // patientMessage, regardless of caregiver gating.
      const patientNotifications = await tc.listNotifications(u.id)
      const angioPatientNotif = patientNotifications.find(
        (n) =>
          /swelling of your face|throat feels tight|angioedema/i.test(n.body) ||
          /911/.test(n.body),
      )
      expect(
        angioPatientNotif,
        'patient T+0 Notification (911 / face-swelling text) must be written',
      ).toBeDefined()

      // §J directive — caregiver-dispatch path is gated behind
      // CAREGIVER_DISPATCH_ENABLED until Lakshitha Gap 5 ships. Assert that
      // gate stays OFF: no CAREGIVER recipientRoles on any T+0 row.
      const caregiverRow = events.find(
        (e) => e.ladderStep === 'T0' && e.recipientRoles.includes('CAREGIVER'),
      )
      expect(
        caregiverRow,
        'caregiver dispatch must remain gated until Lakshitha Gap 5 (CAREGIVER_DISPATCH_ENABLED)',
      ).toBeUndefined()
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})

// Time helpers re-exported to silence unused-import warnings — these
// constants are useful inline if any new sub-case lands.
void MINUTES
void HOURS
