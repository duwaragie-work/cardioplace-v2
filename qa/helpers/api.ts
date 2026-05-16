import { type APIRequestContext, expect } from '@playwright/test'

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
  otherSymptoms?: string[]
  measurementConditions?: Record<string, boolean>
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
