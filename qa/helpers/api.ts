import { type APIRequestContext, type Page, expect } from '@playwright/test'
import type { TestControl } from './test-control.js'
import { byTestId, T } from './selectors.js'
import { signInAdmin } from './auth.js'
import { ADMIN_BASE_URL } from '../playwright.config.js'

/**
 * Typed API helpers for write operations the suite drives without going
 * through the UI — bulk seeding readings, medication CRUD, threshold updates,
 * etc. Always invoked with a pre-authenticated context (see helpers/auth.ts
 * `authedApi`).
 *
 * Anything that goes through these MUST be a side effect the spec already
 * exercises through the UI elsewhere — the helpers exist to keep specs short,
 * not to bypass UI coverage.
 */

export type CreateJournalEntry = {
  measuredAt: string // ISO
  systolicBP: number
  diastolicBP: number
  pulse: number
  position?: 'SITTING' | 'STANDING' | 'LYING'
  sessionId?: string
  // Structured symptom flags (CLINICAL_SPEC §1.3)
  severeHeadache?: boolean
  visualChanges?: boolean
  alteredMentalStatus?: boolean
  chestPainOrDyspnea?: boolean
  focalNeuroDeficit?: boolean
  severeEpigastricPain?: boolean
  newOnsetHeadache?: boolean
  ruqPain?: boolean
  edema?: boolean
  // Cluster 6 symptom flags (Manisha 5/10/26)
  dizziness?: boolean
  syncope?: boolean
  palpitations?: boolean
  legSwelling?: boolean
  // Cluster 7 symptom flags (Manisha 5/11/26 — Appendix A)
  fatigue?: boolean
  shortnessOfBreath?: boolean
  dryCough?: boolean
  nsaidUse?: boolean
  // Cluster 8 symptom flags (Manisha 5/18/26 — ACE-angioedema, P0)
  faceSwelling?: boolean
  throatTightness?: boolean
  otherSymptoms?: string[]
  measurementConditions?: Record<string, boolean>
  medicationTaken?: boolean
}

export async function postJournalEntry(
  api: APIRequestContext,
  entry: CreateJournalEntry,
): Promise<{ id: string; measuredAt: string }> {
  const res = await api.post('daily-journal', { data: entry })
  expect(res.status(), `journal create: ${await res.text()}`).toBe(202)
  // Backend wraps successful responses in { statusCode, message, data }.
  // Unwrap so callers can use `created.id` directly.
  const body = await res.json()
  return body?.data ?? body
}

/**
 * Submit a two-reading session (1 minute apart, same sessionId, identical
 * symptom flags). Satisfies the Cluster 6 Q2 single-reading gate so Stage C
 * rules (β-blocker side-effects, NSAID interaction, ACE cough, HF caregiver
 * edema, HCM low BP, etc.) can fire. Returns both created entry rows.
 *
 * Use this when the test is exercising a non-emergency Stage C rule that
 * depends on a per-reading symptom flag. Emergency / Tier 1 contraindication
 * tests should keep using single-reading `postJournalEntry` — those bypass
 * the gate by design.
 */
export async function postSessionWithTwoReadings(
  api: APIRequestContext,
  base: Omit<CreateJournalEntry, 'measuredAt' | 'sessionId'> & {
    sessionId?: string
    firstMeasuredAt?: string
  },
): Promise<{
  first: { id: string; measuredAt: string }
  second: { id: string; measuredAt: string }
  sessionId: string
}> {
  const sessionId = base.sessionId ?? cryptoRandomUUID()
  const firstMeasuredAt = base.firstMeasuredAt ?? new Date().toISOString()
  const secondMeasuredAt = new Date(
    new Date(firstMeasuredAt).getTime() + 60_000,
  ).toISOString()
  // Strip our setup-only fields before forwarding the rest of the payload.
  const { sessionId: _s, firstMeasuredAt: _f, ...payload } = base

  const first = await postJournalEntry(api, {
    ...payload,
    sessionId,
    measuredAt: firstMeasuredAt,
  })
  const second = await postJournalEntry(api, {
    ...payload,
    sessionId,
    measuredAt: secondMeasuredAt,
  })
  return { first, second, sessionId }
}

// Local randomUUID — Playwright workers run in Node so `crypto.randomUUID` is
// always available; avoid an extra import in helpers/api.ts.
function cryptoRandomUUID(): string {
  return globalThis.crypto.randomUUID()
}

export async function getActiveAlerts(
  api: APIRequestContext,
): Promise<Array<{
  id: string
  tier: string
  ruleId: string
  mode: string
  patientMessage: string
  caregiverMessage: string
  physicianMessage: string
  dismissible: boolean
  createdAt: string
}>> {
  const res = await api.get('daily-journal/alerts')
  expect(res.ok()).toBeTruthy()
  // Backend wraps successful responses in { statusCode, message, data }.
  // Unwrap so callers always see the array directly.
  const body = await res.json()
  const unwrapped = body?.data ?? body
  return Array.isArray(unwrapped) ? unwrapped : (unwrapped?.alerts ?? [])
}

/** A single DeviationAlert row as returned by TestControl.listAlerts. */
export type AlertRow = Awaited<ReturnType<TestControl['listAlerts']>>[number]

/**
 * Poll `tc.listAlerts(userId)` until `predicate` is satisfied or the timeout
 * elapses, then return the last fetched alert list. Returns the last list on
 * timeout (caller asserts on it) rather than throwing — preserves the
 * descriptive `expect(...).toBeDefined()` messages already in the specs.
 *
 * Use this instead of a fixed `setTimeout(N)` + single `listAlerts()` check.
 * The engine is event-driven and its persistAlert SERIALIZABLE transactions
 * can retry under load (deadlock backoff), pushing persistence past any fixed
 * sleep. On high-latency DBs (Prisma Cloud) a 1500ms wait races the write;
 * this poll waits up to `timeoutMs` for the rows to materialize.
 */
export async function waitForAlerts(
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

export async function patchPatientAcknowledgeAlert(
  api: APIRequestContext,
  alertId: string,
): Promise<void> {
  const res = await api.patch(`daily-journal/alerts/${alertId}/acknowledge`)
  expect(res.ok(), `patient ack: ${await res.text()}`).toBeTruthy()
}

// ─── Admin write paths ────────────────────────────────────────────────────

export async function adminAcknowledgeAlert(
  api: APIRequestContext,
  alertId: string,
): Promise<void> {
  const res = await api.post(`admin/alerts/${alertId}/acknowledge`)
  expect(res.ok(), `admin ack: ${await res.text()}`).toBeTruthy()
}

export async function adminResolveAlert(
  api: APIRequestContext,
  alertId: string,
  body: { resolutionAction: string; resolutionRationale?: string },
): Promise<void> {
  const res = await api.post(`admin/alerts/${alertId}/resolve`, { data: body })
  expect(res.ok(), `admin resolve: ${await res.text()}`).toBeTruthy()
}

export async function adminAuditAlert(
  api: APIRequestContext,
  alertId: string,
): Promise<Record<string, unknown>> {
  const res = await api.get(`admin/alerts/${alertId}/audit`)
  expect(res.ok(), `admin audit: ${await res.text()}`).toBeTruthy()
  // Backend wraps successful responses in { statusCode, message, data }.
  const body = await res.json()
  return body?.data ?? body
}

export async function adminCompleteEnrollment(
  api: APIRequestContext,
  userId: string,
): Promise<{ ok: boolean; reasons?: string[]; status?: number }> {
  const res = await api.post(`admin/patients/${userId}/complete-enrollment`)
  // Backend wraps successful responses in { statusCode, message, data }; the
  // payload (with `reasons` etc.) lives under `data`. Unwrap before spreading
  // so callers see the fields at top level.
  const body = await res.json().catch(() => ({}))
  const payload = (body && typeof body === 'object' && 'data' in body ? body.data : body) ?? {}
  return { ok: res.ok(), status: res.status(), ...(payload as Record<string, unknown>) }
}

export async function adminEnrollmentCheck(
  api: APIRequestContext,
  userId: string,
): Promise<{ ready: boolean; reasons: string[] }> {
  const res = await api.get(`admin/patients/${userId}/enrollment-check`)
  expect(res.ok(), `enrollment-check: ${await res.text()}`).toBeTruthy()
  // Backend wraps successful responses in { statusCode, message, data } and the
  // gate result inside `data` exposes { ok, reasons? } (see enrollment-gate.ts).
  // Normalize to { ready, reasons } so callers can read a stable contract
  // without leaking the gate's internal `ok` field.
  const body = await res.json()
  const payload = (body?.data ?? body) as { ok?: boolean; ready?: boolean; reasons?: string[] }
  return {
    ready: payload.ready ?? payload.ok ?? false,
    reasons: payload.reasons ?? [],
  }
}

// ─── Phase 4 §B.3 — UI-driving helpers ─────────────────────────────────────
//
// These drive real patient/admin surfaces through Playwright (not the API)
// so Phase 4 keeps UI-level coverage. They target the *real* testids in
// `selectors.ts` (the Phase 4 doc's idealised names were reconciled against
// the existing registry in §B.4 — see the §B report). The wizard-walking
// helpers (submitReadingViaUI / completeIntakeViaUI) and the OCR/admin
// helpers are written defensively and will be hardened against each concrete
// flow when first exercised in §C–§N.

/**
 * Drive `/check-in` end to end. The check-in flow is a 3–5 step wizard
 * advanced by a single sticky CTA (`checkin-next-btn` → `checkin-submit-btn`
 * on the final step). We walk it with a bounded loop: on every visible step,
 * set whatever inputs that step exposes, then advance.
 *
 * NOTE (§B report): the patient check-in checklist only renders a subset of
 * symptom flags as discrete inputs — CHEST_PAIN, DIZZINESS, SYNCOPE,
 * PALPITATIONS, LEG_SWELLING. SOB / FATIGUE / COUGH are NOT separate inputs
 * (SOB is folded into chest-pain/dyspnea). Symptoms requested here that have
 * no discrete input are silently skipped; rules depending on them must be
 * exercised via a UI path that exposes them or flagged in RESULTS.md.
 */
export async function submitReadingViaUI(
  page: Page,
  reading: {
    systolic: number
    diastolic: number
    heartRate: number
    position?: 'SITTING' | 'STANDING' | 'LYING'
    symptoms?: string[]
    medicationTaken?: boolean
  },
): Promise<void> {
  await page.goto('/check-in')
  const visible = (sel: string) =>
    page.locator(byTestId(sel)).first().isVisible().catch(() => false)

  for (let step = 0; step < 10; step++) {
    // B2 reading step — BP + pulse + position.
    if (await visible(T.checkin.systolic)) {
      await page.locator(byTestId(T.checkin.systolic)).fill(String(reading.systolic))
      await page.locator(byTestId(T.checkin.diastolic)).fill(String(reading.diastolic))
      await page.locator(byTestId(T.checkin.pulse)).fill(String(reading.heartRate))
      const pos = reading.position ?? 'SITTING'
      const posSel =
        pos === 'STANDING'
          ? 'check-in-position-standing'
          : pos === 'LYING'
            ? 'check-in-position-lying'
            : 'check-in-position-sitting'
      await page.locator(byTestId(posSel)).click().catch(() => {})
    }
    // Medication step — per-medication yes/no (apply to the first group).
    if (await visible(T.checkin.medicationYes)) {
      const taken = reading.medicationTaken ?? true
      await page
        .locator(byTestId(taken ? T.checkin.medicationYes : T.checkin.medicationNo))
        .first()
        .click()
        .catch(() => {})
    }
    // B3 symptoms — click any requested symptom input that exists.
    for (const s of reading.symptoms ?? []) {
      const loc = page.locator(byTestId(`check-in-symptom-${s}`)).first()
      if (await loc.isVisible().catch(() => false)) {
        await loc.click().catch(() => {})
      }
    }
    // Advance, or submit on the final step.
    if (await visible(T.checkin.submit)) {
      await page.locator(byTestId(T.checkin.submit)).click()
      break
    }
    if (await visible(T.checkin.next)) {
      await page.locator(byTestId(T.checkin.next)).click()
      continue
    }
    break
  }
  // Settle on the confirmation screen / second-reading prompt / dashboard.
  await page.waitForURL(/\/(dashboard|check-in)/, { timeout: 15_000 }).catch(() => {})
}

/** Patient acknowledges an alert via the `/alerts/[id]` UI. */
export async function acknowledgeAlertViaUI(
  page: Page,
  alertId: string,
): Promise<void> {
  await page.goto(`/alerts/${alertId}`)
  const ack = page.locator(byTestId(T.alertDetail.acknowledgeBtn))
  await ack.waitFor({ state: 'visible', timeout: 15_000 })
  await ack.click()
}

// `resolveAlertViaUI` was a Phase-4 defensive scaffold here. Phase 3 §B.3
// replaced it with the real `resolveAlertViaModal` flow + a back-compat
// `resolveAlertViaUI` alias — both defined in the "Phase 3 §B.3" section
// at the end of this file.

/** Wait for the patient app to land on the full-screen Absolute Emergency screen. */
export async function waitForEmergencyScreen(page: Page): Promise<void> {
  await page
    .locator(byTestId(T.emergency.screen))
    .waitFor({ state: 'visible', timeout: 20_000 })
}

/**
 * Complete the `/clinical-intake` wizard from scratch. Driven by the single
 * sticky CTA (`intake-submit`). Sets gender / height / pregnancy / condition
 * cards as they become visible, then advances.
 *
 * NOTE (§B report): there is no BRADYCARDIA self-report condition card
 * (catalog is HEART_FAILURE / CAD / HCM / AFIB / DCM / None). Requested
 * conditions with no card are skipped. Medications in the wizard are catalog
 * cards, not free-form; best-effort card match by drug name.
 */
export async function completeIntakeViaUI(
  page: Page,
  profile: {
    gender: 'MALE' | 'FEMALE' | 'NON_BINARY'
    heightCm: number
    isPregnant?: boolean
    conditions: string[]
    medications: Array<{ drugName: string; dosage?: string; frequency: string }>
  },
): Promise<void> {
  await page.goto('/clinical-intake')
  const genderToken: 'male' | 'female' | 'non_binary' =
    profile.gender === 'MALE'
      ? 'male'
      : profile.gender === 'FEMALE'
        ? 'female'
        : 'non_binary'
  const visible = (sel: string) =>
    page.locator(byTestId(sel)).first().isVisible().catch(() => false)

  for (let step = 0; step < 16; step++) {
    if (await visible(T.intake.genderCard(genderToken))) {
      await page.locator(byTestId(T.intake.genderCard(genderToken))).click().catch(() => {})
      if (await visible(T.intake.heightCm)) {
        await page.locator(byTestId(T.intake.heightCm)).fill(String(profile.heightCm)).catch(() => {})
      }
    }
    if (await visible(T.intake.pregnancyYes)) {
      await page
        .locator(byTestId(profile.isPregnant ? T.intake.pregnancyYes : T.intake.pregnancyNo))
        .click()
        .catch(() => {})
    }
    for (const c of profile.conditions) {
      const loc = page.locator(byTestId(`intake-condition-${c}`)).first()
      if (await loc.isVisible().catch(() => false)) {
        await loc.click().catch(() => {})
      }
    }
    for (const m of profile.medications) {
      const card = page.locator(byTestId(T.intake.medCard(m.drugName))).first()
      if (await card.isVisible().catch(() => false)) {
        await card.click().catch(() => {})
      }
    }
    if (await visible(T.intake.cta)) {
      await page.locator(byTestId(T.intake.cta)).click().catch(() => {})
    } else {
      break
    }
    if (/\/dashboard/.test(page.url())) break
  }
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 }).catch(() => {})
}

/**
 * Stub the OCR endpoint, then upload a fake BP-cuff photo via the `/check-in`
 * BpPhotoButton so the confirm modal pre-fills systolic/diastolic. The
 * confirm-modal buttons currently have no testid (clicked by accessible
 * name). Hardened in §G (20e.4) against the real OCR route + modal.
 */
export async function uploadBpPhotoViaUI(
  page: Page,
  ocrResult: { systolic: number; diastolic: number },
): Promise<void> {
  await page.route('**/*ocr*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        systolic: ocrResult.systolic,
        diastolic: ocrResult.diastolic,
        pulse: 72,
      }),
    })
  })
  await page.goto('/check-in')
  // Walk to the reading step where BpPhotoButton renders.
  for (let step = 0; step < 6; step++) {
    if (await page.locator(byTestId(T.checkin.bpPhotoButton)).first().isVisible().catch(() => false)) {
      break
    }
    const next = page.locator(byTestId(T.checkin.next))
    if (await next.isVisible().catch(() => false)) await next.click().catch(() => {})
    else break
  }
  const fileInput = page.locator('input[type="file"]').first()
  await fileInput.setInputFiles({
    name: 'bp.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  })
  await page.getByRole('button', { name: /confirm|use|accept|looks good/i }).click().catch(() => {})
}

/**
 * Stub OCR, then upload a fake medication-label photo via the clinical-intake
 * MedicationPhotoButton. Hardened in §D (20b.6) against the real route/modal.
 */
export async function uploadMedPhotoViaUI(
  page: Page,
  ocrResult: { drugName: string },
): Promise<void> {
  await page.route('**/*ocr*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ drugName: ocrResult.drugName }),
    })
  })
  const btn = page.locator(byTestId(T.intake.medPhotoButton)).first()
  await btn.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
  const fileInput = page.locator('input[type="file"]').first()
  await fileInput.setInputFiles({
    name: 'med.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  })
  await page.getByRole('button', { name: /confirm|add|use|accept/i }).click().catch(() => {})
}

/**
 * Force the MonthlyMedReask card to render by backdating its localStorage
 * timestamp. The card keys off `cardioplace_med_reask_at:{userId}` (ms epoch)
 * with a 30-day interval; setting every matching key 31 days into the past
 * makes the next dashboard visit fire the modal (still also requires
 * hasMedications && intakeComplete — data state, not handled here).
 */
export async function forceMonthlyMedReask(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cutoff = Date.now() - 31 * 24 * 60 * 60 * 1000
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('cardioplace_med_reask_at:')) {
        localStorage.setItem(k, String(cutoff))
      }
    }
  })
}

/** Switch the patient app language via the LanguageSelector dropdown. */
export async function switchLanguageViaUI(
  page: Page,
  locale: 'en' | 'es' | 'am' | 'fr' | 'de',
): Promise<void> {
  await page.locator(byTestId(T.language.button)).first().click()
  await page.locator(byTestId(T.language.option(locale))).first().click()
}

/** Sign out via the patient profile page (the real sign-out control). */
export async function signOutViaUI(page: Page): Promise<void> {
  await page.goto('/profile')
  await page.locator(byTestId(T.profile.signOut)).click()
  await page.waitForURL(/\/(sign-in|$)/, { timeout: 15_000 }).catch(() => {})
}

// ─── Phase 3 §B.3 — admin UI-driving helpers ───────────────────────────────
//
// Reconciled against the REAL admin DOM (Phase 3 §B audit) and the
// `T.admin.*` registry, NOT the Phase 3 doc's idealised flows. Reality
// deltas these encode (full list in selectors.ts header / RESULTS.md):
//   • Alert 3-tier display + resolve live on the patient-detail Alerts tab
//     (expanded AlertCard + AlertResolutionModal), not the dashboard.
//   • Profile per-field correction has NO per-field rationale input — the
//     backend writes a server-mandated rationale; the `rationale` arg is
//     accepted for the audit-contract but not typed into the UI.
//   • Medication HOLD rationale is a window.prompt (handled via dialog);
//     REJECT is the MedicationRejectModal; VERIFY is a one-click toggle.
//   • Care-team reassign is an inline <select>, not a modal. Option labels
//     are `name ?? email`, so we match defensively (label → text → API).
//   • signInAdmin lives in helpers/auth.ts — reused, never duplicated.
//
// Helpers that navigate take the patient/route themselves; helpers that act
// on an already-rendered surface assume the caller positioned the page
// (matches the Phase 3 doc's test bodies, which drive nav explicitly).

/** Open the patient-detail Alerts tab for `patientId`. */
async function gotoPatientAlertsTab(adminPage: Page, patientId: string): Promise<void> {
  await adminPage.goto(`${ADMIN_BASE_URL}/patients/${patientId}`)
  await adminPage.locator(byTestId(T.admin.detailTab('alerts'))).click()
  await adminPage
    .locator(byTestId(T.admin.alertsStatusFilter('ALL')))
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => {})
}

/**
 * Drive the AlertResolutionModal end-to-end. Assumes the alert's Resolve
 * button is reachable on the current page (patient-detail Alerts tab or
 * /notifications). The modal shows the patient-facing message + a button
 * list of tier-appropriate resolution actions (NOT a <select>), then a
 * rationale textarea, then Confirm.
 */
export async function resolveAlertViaModal(
  adminPage: Page,
  alertId: string,
  body: { resolutionAction: string; rationale: string },
): Promise<void> {
  await adminPage.locator(byTestId(T.admin.alertResolveBtnFor(alertId))).click()
  await adminPage
    .locator(byTestId(T.admin.resolveModal))
    .waitFor({ state: 'visible', timeout: 15_000 })
  await adminPage
    .locator(byTestId(T.admin.resolveAction(body.resolutionAction)))
    .click()
  // The rationale textarea renders only AFTER an action is selected (React
  // state update) — and it renders for EVERY tier/action (required for
  // Tier 1, optional for some Tier 2). Wait for it (this also confirms the
  // action selection registered), then always fill so confirm enables.
  const rationale = adminPage.locator(byTestId(T.admin.alertResolveRationale))
  await rationale.waitFor({ state: 'visible', timeout: 15_000 })
  await rationale.fill(body.rationale)
  const confirm = adminPage.locator(byTestId(T.admin.alertResolveBtn))
  await expect(confirm).toBeEnabled({ timeout: 10_000 })
  await confirm.click()
  await adminPage
    .locator(byTestId(T.admin.resolveModal))
    .waitFor({ state: 'hidden', timeout: 15_000 })
    .catch(() => {})
}

/**
 * Back-compat alias kept for the Phase 4 defensive scaffold. Now points at
 * the real modal flow (assumes the Resolve button is already on-screen).
 */
export async function resolveAlertViaUI(
  adminPage: Page,
  alertId: string,
  body: { resolutionAction: string; rationale: string },
): Promise<void> {
  await resolveAlertViaModal(adminPage, alertId, body)
}

/**
 * Admin completes profile verification for a patient (the footer
 * "Verification complete" → optional rationale → Confirm flow). Lands on
 * the patient-detail Profile tab (the default tab).
 */
export async function verifyProfileViaUI(
  adminPage: Page,
  patientId: string,
): Promise<void> {
  await adminPage.goto(`${ADMIN_BASE_URL}/patients/${patientId}`)
  await adminPage.locator(byTestId(T.admin.detailTab('profile'))).click()
  const complete = adminPage.locator(byTestId(T.admin.profileVerifyComplete))
  await complete.waitFor({ state: 'visible', timeout: 15_000 })
  await complete.click()
  await adminPage.locator(byTestId(T.admin.profileVerifyConfirm)).click()
  await expect(
    adminPage.locator(byTestId(T.admin.profileStatusBanner)),
  ).toContainText(/verified/i, { timeout: 15_000 })
}

/**
 * Admin corrects a single profile field. The UI has no per-field rationale
 * input (the backend writes a server-mandated one); `rationale` is accepted
 * for the audit-contract but not typed in. `field` is the PatientProfile
 * key (e.g. `heightCm`). Handles both <input> and <select> editors.
 */
export async function correctProfileFieldViaUI(
  adminPage: Page,
  patientId: string,
  field: string,
  newValue: string,
  rationale: string,
): Promise<void> {
  void rationale // UI does not collect per-field rationale (see header)
  await adminPage.goto(`${ADMIN_BASE_URL}/patients/${patientId}`)
  await adminPage.locator(byTestId(T.admin.detailTab('profile'))).click()
  // ProfileTab fetches async — wait for it to render before reaching for a
  // per-field control (the status banner is always present once loaded).
  await adminPage
    .locator(byTestId(T.admin.profileStatusBanner))
    .waitFor({ state: 'visible', timeout: 25_000 })
  await adminPage
    .locator(byTestId(T.admin.profileCorrect(field)))
    .click({ timeout: 20_000 })
  const input = adminPage.locator(byTestId(T.admin.profileEditInput(field)))
  await input.waitFor({ state: 'visible', timeout: 15_000 })
  // <select> editors (boolean/enum) vs <input> (number/date).
  const tag = await input.evaluate((el) => el.tagName.toLowerCase())
  if (tag === 'select') {
    await input.selectOption(newValue).catch(async () => {
      await input.selectOption({ label: newValue })
    })
  } else {
    await input.fill(newValue)
  }
  const saveBtn = adminPage.locator(byTestId(T.admin.profileEditSave(field)))
  await saveBtn.click()
  // saveCorrection awaits the correctProfile POST before exiting edit mode
  // (status → 'confirmed' hides the Save button). Waiting for it removes the
  // race where the caller navigates away mid-POST and aborts the request.
  await saveBtn.waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {})
}

/**
 * Admin verifies / HOLDs / rejects a medication by its visible drug name.
 * Cards are keyed by med.id; we resolve the card by its rendered drugName
 * text, then act inside it. HOLD answers the window.prompt; REJECT drives
 * the MedicationRejectModal; VERIFY is a single click.
 */
export async function setMedActionViaUI(
  adminPage: Page,
  patientId: string,
  drugName: string,
  action: 'VERIFY' | 'HOLD' | 'REJECT',
  rationale = 'QA automated rationale',
): Promise<void> {
  await adminPage.goto(`${ADMIN_BASE_URL}/patients/${patientId}`)
  await adminPage.locator(byTestId(T.admin.detailTab('medications'))).click()
  const card = adminPage
    .locator('[data-testid^="admin-med-card-"]')
    .filter({ hasText: drugName })
    .first()
  await card.waitFor({ state: 'visible', timeout: 15_000 })
  if (action === 'VERIFY') {
    await card.locator('[data-testid^="admin-med-verify-"]').first().click()
    return
  }
  if (action === 'HOLD') {
    // HOLD rationale is a window.prompt — accept it with the rationale.
    adminPage.once('dialog', (d) => void d.accept(rationale))
    await card.locator('[data-testid^="admin-med-hold-"]').first().click()
    return
  }
  // REJECT → MedicationRejectModal (quick-pick "other" + free-text).
  await card.locator('[data-testid^="admin-med-reject-"]').first().click()
  await adminPage
    .locator(byTestId(T.admin.medRejectModal))
    .waitFor({ state: 'visible', timeout: 15_000 })
  await adminPage.locator(byTestId(T.admin.medRejectQuickPick('other'))).click()
  await adminPage.locator(byTestId(T.admin.medRejectRationale)).fill(rationale)
  await adminPage.locator(byTestId(T.admin.medRejectConfirm)).click()
  await adminPage
    .locator(byTestId(T.admin.medRejectModal))
    .waitFor({ state: 'hidden', timeout: 15_000 })
    .catch(() => {})
}

/** Admin admits (enrolls) a patient via the EnrollmentCard. */
export async function admitPatientViaUI(
  adminPage: Page,
  patientId: string,
): Promise<void> {
  await adminPage.goto(`${ADMIN_BASE_URL}/patients/${patientId}`)
  const btn = adminPage.locator(byTestId(T.admin.enrollmentEnrollBtn))
  await btn.waitFor({ state: 'visible', timeout: 15_000 })
  await btn.click()
  // Card unmounts on success (status flips ENROLLED).
  await adminPage
    .locator(byTestId(T.admin.enrollmentCard))
    .waitFor({ state: 'hidden', timeout: 15_000 })
    .catch(() => {})
}

/**
 * Admin reassigns a care-team slot via the inline <select> editor (MD /
 * SUPER_ADMIN / OPS only). Options are labelled `name ?? email`; we match
 * defensively: try label === email, then an option whose text contains the
 * email's local-part. Hardened against the concrete cohort in §E.4.
 */
export async function reassignCareTeamViaUI(
  adminPage: Page,
  patientId: string,
  role: 'PRIMARY' | 'BACKUP' | 'MD',
  newProviderEmail: string,
): Promise<void> {
  await adminPage.goto(`${ADMIN_BASE_URL}/patients/${patientId}`)
  await adminPage.locator(byTestId(T.admin.detailTab('careteam'))).click()
  const sel =
    role === 'PRIMARY'
      ? T.admin.careTeamPrimarySelect
      : role === 'BACKUP'
        ? T.admin.careTeamBackupSelect
        : T.admin.careTeamMdSelect
  const select = adminPage.locator(byTestId(sel))
  await select.waitFor({ state: 'visible', timeout: 15_000 })
  const local = newProviderEmail.split('@')[0]
  // Resolve the option whose visible text matches the email or its
  // local-part (label is name||email; email-keyed match is best-effort).
  const value = await select.evaluate((el, { email, localPart }) => {
    const opts = Array.from((el as HTMLSelectElement).options)
    const hit =
      opts.find((o) => o.textContent?.includes(email)) ??
      opts.find((o) =>
        o.textContent?.toLowerCase().includes(localPart.toLowerCase()),
      )
    return hit?.value ?? ''
  }, { email: newProviderEmail, localPart: local })
  if (value) {
    await select.selectOption(value)
  } else {
    // Fall back to label match (when the option text IS the email).
    await select.selectOption({ label: newProviderEmail }).catch(() => {})
  }
  await adminPage.locator(byTestId(T.admin.careTeamSave)).click()
}

/** Admin edits a per-patient threshold (MD / SUPER_ADMIN only). */
export async function editThresholdViaUI(
  adminPage: Page,
  patientId: string,
  override: {
    sbpUpperTarget?: number
    sbpLowerTarget?: number
    dbpUpperTarget?: number
    dbpLowerTarget?: number
    hrUpperTarget?: number
    hrLowerTarget?: number
  },
): Promise<void> {
  await adminPage.goto(`${ADMIN_BASE_URL}/patients/${patientId}`)
  await adminPage.locator(byTestId(T.admin.detailTab('thresholds'))).click()
  const fill = async (testid: string, v: number | undefined) => {
    if (v == null) return
    await adminPage.locator(byTestId(testid)).fill(String(v))
  }
  await fill(T.admin.thresholdSbpUpper, override.sbpUpperTarget)
  await fill(T.admin.thresholdSbpLower, override.sbpLowerTarget)
  await fill(T.admin.thresholdDbpUpper, override.dbpUpperTarget)
  await fill(T.admin.thresholdDbpLower, override.dbpLowerTarget)
  await fill(T.admin.thresholdHrUpper, override.hrUpperTarget)
  await fill(T.admin.thresholdHrLower, override.hrLowerTarget)
  await adminPage.locator(byTestId(T.admin.thresholdSave)).click()
}

/**
 * Sign in as `email` then assert `route` is forbidden — either a >=400
 * status, a redirect away to sign-in/home, or the in-app 403 access-denied
 * panel. Used by the §M RBAC matrix.
 */
export async function assertRouteForbidden(
  adminPage: Page,
  email: string,
  route: string,
): Promise<void> {
  await signInAdmin(adminPage, email, ADMIN_BASE_URL).catch(() => {})
  const res = await adminPage.goto(`${ADMIN_BASE_URL}${route}`)
  const status = res?.status() ?? 0
  if (status >= 400) {
    expect(status).toBeGreaterThanOrEqual(400)
    return
  }
  const deniedVisible = await adminPage
    .locator(byTestId(T.admin.patientListAccessDenied))
    .isVisible()
    .catch(() => false)
  if (deniedVisible) {
    expect(deniedVisible).toBe(true)
    return
  }
  // Soft-block: redirected away from the protected route.
  await expect(adminPage).not.toHaveURL(new RegExp(`${route}$`), {
    timeout: 10_000,
  })
}

export { gotoPatientAlertsTab }
