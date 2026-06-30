import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { authedApi, signInPatient, signInAdmin } from '../helpers/auth.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'

/**
 * Option D — retake-to-confirm for BP-only emergencies (Manisha 2026-06-12 Q2).
 *
 * A BP ≥180/120 reading WITHOUT symptoms is held (AWAITING — no alert pages
 * anyone) and the patient is asked to take a confirmatory second reading.
 * Three outcomes, all exercised end-to-end through the public daily-journal
 * endpoints (the same calls the check-in submit handler makes):
 *
 *   1. First held → NO alert during the stability window (the whole point —
 *      a single extreme reading must not page on its own).
 *   2. Confirmatory reading STILL ≥180/120 → RULE_ABSOLUTE_EMERGENCY (BP L2).
 *   3. Confirmatory reading BELOW threshold → RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL
 *      (Tier 3 informational); NO BP Level 2 fires.
 *   4. Patient declines (decline-confirmation) → RULE_UNCONFIRMED_EMERGENCY
 *      (Tier 1, PROVIDER-ONLY: empty patient message), locked physician wording.
 */

type AlertRow = Awaited<ReturnType<TestControl['listAlerts']>>[number]

async function waitForAlerts(
  tc: TestControl,
  userId: string,
  predicate: (alerts: AlertRow[]) => boolean,
  timeoutMs = 12_000,
): Promise<AlertRow[]> {
  const deadline = Date.now() + timeoutMs
  let last: AlertRow[] = []
  while (Date.now() < deadline) {
    last = await tc.listAlerts(userId)
    if (predicate(last)) return last
    await new Promise((r) => setTimeout(r, 200))
  }
  return last
}

async function expectNoAlerts(
  tc: TestControl,
  userId: string,
  predicate: (alerts: AlertRow[]) => boolean,
  stabilityMs = 2500,
): Promise<AlertRow[]> {
  const start = Date.now()
  let last: AlertRow[] = []
  while (Date.now() - start < stabilityMs) {
    last = await tc.listAlerts(userId)
    if (predicate(last)) return last
    await new Promise((r) => setTimeout(r, 300))
  }
  return last
}

test.describe('Option D — BP-only emergency retake-to-confirm (Manisha 2026-06-12 Q2)', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (mutates seed-patient journal entries)',
  )

  test('first reading is HELD (no alert), confirmatory ≥180/120 → RULE_ABSOLUTE_EMERGENCY (BP Level 2)', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      const sessionId = randomUUID()
      // Begin — held first-of-pair.
      const first = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 195,
          diastolicBP: 120,
          pulse: 88,
          position: 'SITTING',
          sessionId,
          beginEmergencyConfirmation: true,
        },
      })
      expect(first.status()).toBe(202)
      const firstBody = await first.json()
      expect(firstBody.pendingEmergencyConfirmation).toBe(true)
      const firstId = firstBody.data.id

      // Held — no alert of any tier fires on the lone AWAITING reading.
      const held = await expectNoAlerts(tc, u.id, (xs) => xs.some((a) => a.status === 'OPEN'))
      expect(held.filter((a) => a.status === 'OPEN')).toEqual([])

      // Confirmatory reading, still emergency range.
      const second = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 190,
          diastolicBP: 121,
          pulse: 90,
          position: 'SITTING',
          sessionId,
          confirmsEntryId: firstId,
        },
      })
      expect(second.status()).toBe(202)

      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_2'),
      )
      const l2 = alerts.filter((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_2')
      expect(l2.length, `expected a confirmed BP Level 2 emergency`).toBeGreaterThan(0)
      expect(l2[0]!.ruleId).toBe('RULE_ABSOLUTE_EMERGENCY')

      // Once confirmed, the first-of-pair must NOT stay AWAITING — otherwise the
      // readings tab would show the read-only "Held" badge on it forever.
      const list = await api.get('daily-journal')
      const entries = ((await list.json()).data ?? []) as Array<{
        id: string
        emergencyConfirmation?: string | null
      }>
      const firstOfPair = entries.find((e) => e.id === firstId)
      expect(firstOfPair, 'first-of-pair still present').toBeTruthy()
      expect(
        firstOfPair!.emergencyConfirmation,
        'confirmed first-of-pair must be released from AWAITING',
      ).not.toBe('AWAITING')
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('confirmatory reading BELOW threshold → RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL (Tier 3), no BP Level 2', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      const sessionId = randomUUID()
      const first = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 195,
          diastolicBP: 120,
          position: 'SITTING',
          sessionId,
          beginEmergencyConfirmation: true,
        },
      })
      expect(first.status()).toBe(202)
      const firstId = (await first.json()).data.id

      const second = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 135,
          diastolicBP: 85,
          position: 'SITTING',
          sessionId,
          confirmsEntryId: firstId,
        },
      })
      expect(second.status()).toBe(202)

      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL'),
      )
      const confirmedNormal = alerts.filter(
        (a) => a.ruleId === 'RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL',
      )
      expect(confirmedNormal.length, 'expected a Tier 3 confirmed-normal flag').toBeGreaterThan(0)
      expect(confirmedNormal[0]!.tier).toBe('TIER_3_INFO')
      // No emergency ladder — the confirmatory reading cleared it.
      expect(alerts.some((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_2')).toBeFalsy()
      // Provider-only physician message names both readings.
      expect(confirmedNormal[0]!.physicianMessage).toContain('195/120')
      expect(confirmedNormal[0]!.physicianMessage).toContain('135/85')
      expect(confirmedNormal[0]!.patientMessage).toBeFalsy()
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('an AWAITING reading anchors its own session, never joining an open in-window session (Bug 4 follow-up)', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      // A normal reading opens an in-window session.
      const normal = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 122,
          diastolicBP: 80,
          position: 'SITTING',
          sessionId: randomUUID(),
        },
      })
      expect(normal.status()).toBe(202)
      const normalSession = (await normal.json()).data.sessionId

      // A held emergency reading within the window must NOT be merged into it —
      // it anchors its own session so the confirmatory reading can pair into it.
      const held = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 195,
          diastolicBP: 120,
          position: 'SITTING',
          sessionId: randomUUID(),
          beginEmergencyConfirmation: true,
        },
      })
      expect(held.status()).toBe(202)
      const heldSession = (await held.json()).data.sessionId

      expect(heldSession).not.toBe(normalSession)
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('Bug 13 (+ Part 2) — CONFIRMATORY inherits position, medication, weight + pulse from the held first-of-pair', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      const sessionId = randomUUID()
      // First-of-pair carries the full sitting context.
      const first = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 195,
          diastolicBP: 120,
          position: 'SITTING',
          medicationTaken: true,
          weight: 90.7,
          pulse: 88,
          sessionId,
          beginEmergencyConfirmation: true,
        },
      })
      expect(first.status()).toBe(202)
      const firstId = (await first.json()).data.id

      // Screen B only re-collects BP — no position, meds, weight, or pulse.
      const second = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 135,
          diastolicBP: 85,
          sessionId,
          confirmsEntryId: firstId,
        },
      })
      expect(second.status()).toBe(202)

      const list = await api.get('daily-journal')
      const entries = ((await list.json()).data ?? []) as Array<{
        emergencyConfirmation?: string | null
        position?: string | null
        medicationTaken?: boolean | null
        weight?: number | null
        pulse?: number | null
      }>
      const confirmatory = entries.find((e) => e.emergencyConfirmation === 'CONFIRMATORY')
      expect(confirmatory, 'confirmatory entry exists').toBeTruthy()
      // Inherited from the first-of-pair (same sitting).
      expect(confirmatory!.position).toBe('SITTING')
      expect(confirmatory!.medicationTaken).toBe(true)
      // Bug 13 Part 2 — weight + pulse also inherited when Screen B omits them.
      expect(confirmatory!.weight).toBe(90.7)
      expect(confirmatory!.pulse).toBe(88)
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('patient declines → RULE_UNCONFIRMED_EMERGENCY (Tier 1, provider-only) with locked wording', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      const sessionId = randomUUID()
      const first = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 195,
          diastolicBP: 120,
          position: 'SITTING',
          sessionId,
          beginEmergencyConfirmation: true,
        },
      })
      expect(first.status()).toBe(202)
      const firstId = (await first.json()).data.id

      // Patient declines the retake.
      const decline = await api.post(`daily-journal/${firstId}/decline-confirmation`)
      expect(decline.status()).toBeGreaterThanOrEqual(200)
      expect(decline.status()).toBeLessThan(300)

      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_UNCONFIRMED_EMERGENCY'),
      )
      const unconfirmed = alerts.filter((a) => a.ruleId === 'RULE_UNCONFIRMED_EMERGENCY')
      expect(unconfirmed.length, 'expected a Tier 1 unconfirmed-emergency flag').toBeGreaterThan(0)
      const a = unconfirmed[0]!
      expect(a.tier).toBe('TIER_1_CONTRAINDICATION')
      // Locked Manisha wording + provider-only (no patient message).
      expect(a.physicianMessage).toContain(
        'Single unconfirmed emergency-range reading',
      )
      expect(a.physicianMessage).toContain('195/120 mmHg')
      expect(a.patientMessage).toBeFalsy()
      // No emergency (BP Level 2) on the lone unconfirmed reading.
      expect(alerts.some((x) => x.status === 'OPEN' && x.tier === 'BP_LEVEL_2')).toBeFalsy()

      // Bug 12 — the provider-only flag must NOT appear on the PATIENT's own
      // alerts feed (it has an empty patientMessage). The patient endpoint
      // filters it server-side regardless of tier.
      const feedRes = await api.get('daily-journal/alerts')
      expect(feedRes.status()).toBe(200)
      const feed = await feedRes.json()
      const patientAlerts = (feed.data ?? feed) as Array<{ ruleId?: string | null }>
      expect(
        patientAlerts.some((x) => x.ruleId === 'RULE_UNCONFIRMED_EMERGENCY'),
        'provider-only RULE_UNCONFIRMED_EMERGENCY must not leak into the patient alerts feed',
      ).toBeFalsy()
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  // ── AWAITING UX revision (2026-06-16) — patient-facing /readings + /check-in ──
  // The held emergency is no longer an opaque "Held" lock: /readings shows a
  // clear "Awaiting your second reading" status + a "Continue confirmation" CTA,
  // and the CTA (or a direct /check-in visit) auto-resumes Screen A so the
  // patient can finish. Edit/delete stay suppressed while AWAITING.
  test('readings shows the AWAITING status + Continue CTA (no Held lock, no edit/delete); CTA resumes Screen A; confirming clears it', async ({
    page,
  }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      // Held first-of-pair (195/120, no symptoms) → AWAITING.
      const first = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 195,
          diastolicBP: 120,
          pulse: 88,
          position: 'SITTING',
          sessionId: randomUUID(),
          beginEmergencyConfirmation: true,
        },
      })
      expect(first.status()).toBe(202)
      const firstId = (await first.json()).data.id

      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/readings')

      // The AWAITING reading shows the action-oriented status + recovery CTA…
      await expect(
        page.locator(byTestId(T.readings.rowAwaiting(firstId))),
      ).toBeVisible({ timeout: 15_000 })
      await expect(
        page.locator(byTestId(T.readings.rowContinueConfirmation(firstId))),
      ).toBeVisible()
      // …and NOT the old "Held" lock label, nor edit/delete affordances.
      await expect(page.getByText('Held', { exact: true })).toHaveCount(0)
      await expect(
        page.locator(byTestId(T.readings.rowDelete(firstId))),
      ).toHaveCount(0)

      // Bugs 10+11 Part 2 — tapping the AWAITING card opens the read-only detail
      // modal, which must NOT offer an "Edit Reading" bypass of the card-level
      // suppression. Click the card header (top-left), away from the CTA button.
      await page
        .locator(byTestId(`readings-row-${firstId}`))
        .click({ position: { x: 40, y: 16 } })
      await expect(page.locator(byTestId('reading-detail-modal'))).toBeVisible({
        timeout: 10_000,
      })
      await expect(
        page.locator(byTestId('reading-detail-edit-btn')),
      ).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(page.locator(byTestId('reading-detail-modal'))).toHaveCount(0)

      // Tapping the CTA resumes Screen A on /check-in with the held BP shown.
      await page.locator(byTestId(T.readings.rowContinueConfirmation(firstId))).click()
      await expect(page).toHaveURL(/\/check-in/, { timeout: 15_000 })
      await expect(page.locator(byTestId(T.optionD.resumeIntro))).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.locator(byTestId(T.optionD.retake))).toBeVisible()
      await expect(page.getByText(/195\s*\/\s*120/)).toBeVisible()

      // Take a (normal) confirmatory reading → Bug 26: the confirmed-normal
      // Screen C reassurance renders first, then its Done CTA → dashboard.
      await page.locator(byTestId(T.optionD.retake)).click()
      await page.locator(byTestId(T.optionD.systolic)).fill('128')
      await page.locator(byTestId(T.optionD.diastolic)).fill('82')
      await page.locator(byTestId(T.optionD.submitSecond)).click()
      await expect(page.locator(byTestId('optiond-screenc-title'))).toBeVisible({ timeout: 15_000 })
      await page.locator(byTestId(T.optionD.done)).click()
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

      // Back on /readings the original entry is released from AWAITING: the
      // status badge + CTA are gone and it's an ordinary editable reading again.
      await page.goto('/readings')
      await expect(
        page.locator(byTestId(T.readings.rowAwaiting(firstId))),
      ).toHaveCount(0, { timeout: 15_000 })
      await expect(
        page.locator(byTestId(T.readings.rowContinueConfirmation(firstId))),
      ).toHaveCount(0)
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('navigating directly to /check-in auto-resumes Screen A when a held emergency is awaiting', async ({
    page,
  }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      const first = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 195,
          diastolicBP: 120,
          position: 'SITTING',
          sessionId: randomUUID(),
          beginEmergencyConfirmation: true,
        },
      })
      expect(first.status()).toBe(202)

      await signInPatient(page, PATIENTS.aisha.email)
      // Straight to /check-in (not via the CTA) — Screen A auto-renders with the
      // resume intro instead of the normal wizard form.
      await page.goto('/check-in')
      await expect(page.locator(byTestId(T.optionD.resumeIntro))).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.locator(byTestId(T.optionD.retake))).toBeVisible()
      await expect(page.getByText(/195\s*\/\s*120/)).toBeVisible()
      // The wizard's BP step must NOT be what rendered.
      await expect(page.locator(byTestId(T.checkin.systolic))).toHaveCount(0)
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  // ── Bug 14 (2026-06-16) — Option D entries must not trap unrelated readings ──
  // A declined emergency (its own UNCONFIRMED session) + a fresh reading minutes
  // later must render as TWO separate sessions on BOTH apps. Pre-fix the patient
  // app proximity-grouped them into one "Avg 170/103" card while admin (strict
  // by sessionId) correctly showed two — the apps disagreed.
  test('Bug 14 — a declined emergency + a fresh reading 3 min later are TWO sessions on patient AND admin', async ({
    page,
  }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      // Held emergency → decline → UNCONFIRMED (its own session).
      const first = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 195,
          diastolicBP: 120,
          position: 'SITTING',
          sessionId: randomUUID(),
          beginEmergencyConfirmation: true,
        },
      })
      expect(first.status()).toBe(202)
      const declinedId = (await first.json()).data.id
      const decline = await api.post(`daily-journal/${declinedId}/decline-confirmation`)
      expect(decline.status()).toBeGreaterThanOrEqual(200)
      expect(decline.status()).toBeLessThan(300)

      // Fresh ordinary reading ~now (well within the 5-min proximity window).
      // closeSession commits it immediately (buffer fast-fire) so it leaves the
      // 5-min editable hold and is visible on the provider Readings tab — its
      // own sessionId is set explicitly, so the distinct-session assertion below
      // is unaffected.
      const second = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 145,
          diastolicBP: 85,
          position: 'SITTING',
          sessionId: randomUUID(),
          closeSession: true,
        },
      })
      expect(second.status()).toBe(202)
      const freshId = (await second.json()).data.id

      // Part A — the backend anchors them in DIFFERENT non-null sessions.
      const list = await api.get('daily-journal')
      const entries = ((await list.json()).data ?? []) as Array<{
        id: string
        sessionId?: string | null
      }>
      const declined = entries.find((e) => e.id === declinedId)
      const fresh = entries.find((e) => e.id === freshId)
      expect(declined?.sessionId, 'declined has a session').toBeTruthy()
      expect(fresh?.sessionId, 'fresh has a session').toBeTruthy()
      expect(
        declined?.sessionId,
        'declined emergency + fresh reading must be different sessions',
      ).not.toBe(fresh?.sessionId)

      // Part B — patient /readings shows TWO standalone cards (a collapsed
      // SessionCard would hide its children, so both rows being directly
      // visible proves they were NOT proximity-merged into one session).
      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/readings')
      await expect(
        page.locator(byTestId(`readings-row-${declinedId}`)),
      ).toBeVisible({ timeout: 15_000 })
      await expect(
        page.locator(byTestId(`readings-row-${freshId}`)),
      ).toBeVisible()

      // Regression guard — admin Readings tab also shows two separate cards
      // (its strict-by-sessionId grouping was already correct; confirm unbroken).
      await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/patients/${u.id}`)
      await page.locator(byTestId(T.admin.detailTab('readings'))).click()
      await expect(page.locator(byTestId(T.admin.readingsList))).toBeVisible({
        timeout: 25_000,
      })
      await expect(
        page.locator(byTestId(T.admin.readingsCard(declinedId))),
      ).toBeVisible()
      await expect(
        page.locator(byTestId(T.admin.readingsCard(freshId))),
      ).toBeVisible()
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('Bug 14 — a confirmed-normal Option D pair groups together; a fresh reading stays a separate session', async ({
    page,
  }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      const pairSession = randomUUID()
      // Held emergency → confirmatory sub-threshold (CONFIRMED_NORMAL), same session.
      const held = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 195,
          diastolicBP: 120,
          position: 'SITTING',
          sessionId: pairSession,
          beginEmergencyConfirmation: true,
        },
      })
      expect(held.status()).toBe(202)
      const heldId = (await held.json()).data.id
      const confirm = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 135,
          diastolicBP: 85,
          position: 'SITTING',
          sessionId: pairSession,
          confirmsEntryId: heldId,
        },
      })
      expect(confirm.status()).toBe(202)
      const confirmId = (await confirm.json()).data.id

      // Fresh ordinary reading within 5 min — must NOT join the confirmed pair.
      const freshRes = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 140,
          diastolicBP: 85,
          position: 'SITTING',
          sessionId: randomUUID(),
        },
      })
      expect(freshRes.status()).toBe(202)
      const freshId = (await freshRes.json()).data.id

      // Part A — the pair shares a session; the fresh reading is separate.
      const list = await api.get('daily-journal')
      const entries = ((await list.json()).data ?? []) as Array<{
        id: string
        sessionId?: string | null
      }>
      const heldE = entries.find((e) => e.id === heldId)
      const confE = entries.find((e) => e.id === confirmId)
      const freshE = entries.find((e) => e.id === freshId)
      expect(heldE?.sessionId).toBe(confE?.sessionId)
      expect(freshE?.sessionId).not.toBe(heldE?.sessionId)

      // Part B — patient /readings: the pair collapses into ONE SessionCard (so
      // their individual rows are NOT directly visible), while the fresh reading
      // renders as its own standalone card.
      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/readings')
      await expect(
        page.locator(byTestId(`readings-row-${freshId}`)),
      ).toBeVisible({ timeout: 15_000 })
      await expect(page.locator(byTestId(`readings-row-${heldId}`))).toHaveCount(0)
      await expect(
        page.locator(byTestId(`readings-row-${confirmId}`)),
      ).toHaveCount(0)
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})
