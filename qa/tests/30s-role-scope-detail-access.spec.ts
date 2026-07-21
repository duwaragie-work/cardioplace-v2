import { test, expect } from '@playwright/test'

import { gotoPatientDetailById } from '../helpers/api.js'
import { signInAdmin, authedApi } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * May 2026 role-scope refactor — patient-detail access guard (batch 30s).
 *
 * Covers the bug fixes IV-11 (MD opens out-of-scope patient → clean redirect,
 * not an error banner) and CT-005 (PROVIDER unassigned patient → 403). The
 * PatientDetailShell catches a 403 from getPatientSummary and bounces to
 * `/patients?reason=out-of-scope` (PatientDetailShell.tsx:176).
 *
 * A non-existent userId is the deterministic out-of-scope fixture: no
 * PatientProviderAssignment row exists, so assertCanAccessPatient throws
 * ForbiddenException for PROVIDER + MED_DIR (scoped roles) but short-circuits
 * for OPS/SUPER (unscoped → the downstream lookup 404s instead, which is NOT
 * the out-of-scope redirect — that's the negative assertion in case 4).
 *
 * June 2026 update (Manisha 2026-06-12 Doc 3 Q2): the PROVIDER detail check
 * is now practice-membership-based, not primary/backup-OR. With the single
 * seed practice both checks deny the same absent-id case, so this spec keeps
 * its coverage unchanged. The new positive case (PROVIDER opens a non-
 * assigned in-practice patient → detail loads) is in 31-practice-visibility-
 * refactor.spec.ts. Negative cross-practice case is gated on seed expansion
 * (see SCOPE NOTE in 30r-role-scope-lists.spec.ts).
 */

// Well-formed but guaranteed-absent ULID. assertCanAccessPatient findUnique
// returns null → 403 for scoped roles.
const ABSENT_PATIENT_ID = '00000000000000000000000000'
const OUT_OF_SCOPE_URL = /\/patients\?reason=out-of-scope/

test.describe('30s — patient-detail role-scope access guard', () => {
  // ── Happy path: PROVIDER opens an assigned patient ────────────────────────
  test('PROVIDER opens an assigned patient → detail loads (no redirect)', async ({ page }) => {
    // Every seed patient is on primaryProvider's panel, so Priya is in scope.
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const priya = await tc.findUser(PATIENTS.priya.email)
    await tc.dispose()

    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, priya.id)

    // Detail header renders; URL stays on the detail route (no bounce).
    await expect(page.locator(byTestId(T.admin.detailHeader))).toBeVisible({ timeout: 30_000 })
    expect(page.url()).not.toMatch(OUT_OF_SCOPE_URL)
  })

  // ── PROVIDER + MED_DIR bounce out of an out-of-scope patient ──────────────
  test('PROVIDER opens out-of-scope patient → redirect to /patients?reason=out-of-scope', async ({ page }) => {
    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, ABSENT_PATIENT_ID)
    await page.waitForURL(OUT_OF_SCOPE_URL, { timeout: 30_000 })
    expect(page.url()).toMatch(OUT_OF_SCOPE_URL)
  })

  test('MED_DIR opens out-of-scope patient → redirect to /patients?reason=out-of-scope', async ({ page }) => {
    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, ABSENT_PATIENT_ID)
    await page.waitForURL(OUT_OF_SCOPE_URL, { timeout: 30_000 })
    expect(page.url()).toMatch(OUT_OF_SCOPE_URL)
  })

  // ── OPS is unscoped — must NOT get the out-of-scope redirect ──────────────
  test('OPS opens absent patient → does NOT get the out-of-scope redirect', async ({ page }) => {
    // OPS short-circuits the scope check; the absent id 404s downstream
    // instead. The meaningful distinction is that OPS is never bounced with
    // the out-of-scope reason — they have org-wide read access.
    await signInAdmin(page, ADMINS.ops.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, ABSENT_PATIENT_ID)
    // Give the shell time to resolve the summary fetch + any redirect.
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    expect(page.url()).not.toMatch(OUT_OF_SCOPE_URL)
  })

  // ── API parity: scoped GET routes return 403 for out-of-scope patient ─────
  test('API: PROVIDER GET /admin/users/:id/profile returns 403 for out-of-scope patient', async () => {
    const api = await authedApi(API_BASE_URL, ADMINS.primaryProvider.email, 'admin')
    const res = await api.get(`admin/users/${ABSENT_PATIENT_ID}/profile`)
    expect(
      res.status(),
      `expected 403 for out-of-scope profile read, got ${res.status()}: ${await res.text()}`,
    ).toBe(403)
    await api.dispose()
  })
})

// NIVA_CAREGIVER_AUTHZ_FIX — the admin caregiver endpoints (PHI-sharing config)
// must enforce per-patient scope, not just @Roles. A scoped PROVIDER must be
// blocked from another practice's patient on every verb; an unscoped OPS must
// not. ABSENT_PATIENT_ID is the deterministic out-of-scope fixture (no
// assignment row → assertCanAccessPatient throws for scoped roles).
test.describe('30s — admin caregiver endpoints enforce per-patient scope (PHI)', () => {
  const base = `admin/patients/${ABSENT_PATIENT_ID}/caregivers`

  test('PROVIDER GET caregivers → 403 for out-of-scope patient', async () => {
    const api = await authedApi(API_BASE_URL, ADMINS.primaryProvider.email, 'admin')
    const res = await api.get(base)
    expect(res.status(), await res.text()).toBe(403)
    await api.dispose()
  })

  test('PROVIDER POST caregiver → 403 for out-of-scope patient', async () => {
    const api = await authedApi(API_BASE_URL, ADMINS.primaryProvider.email, 'admin')
    // Valid body (name is the only required field) so the request reaches the
    // handler's scope check rather than 400-ing at the validation pipe.
    const res = await api.post(base, { data: { name: 'Scope Test' } })
    expect(res.status(), await res.text()).toBe(403)
    await api.dispose()
  })

  test('PROVIDER PATCH caregiver → 403 for out-of-scope patient', async () => {
    const api = await authedApi(API_BASE_URL, ADMINS.primaryProvider.email, 'admin')
    const res = await api.patch(`${base}/cg-x`, { data: { name: 'Scope Test' } })
    expect(res.status(), await res.text()).toBe(403)
    await api.dispose()
  })

  test('PROVIDER DELETE caregiver → 403 for out-of-scope patient', async () => {
    const api = await authedApi(API_BASE_URL, ADMINS.primaryProvider.email, 'admin')
    const res = await api.delete(`${base}/cg-x`)
    expect(res.status(), await res.text()).toBe(403)
    await api.dispose()
  })

  test('OPS GET caregivers → NOT 403 (org-wide scope, short-circuits)', async () => {
    const api = await authedApi(API_BASE_URL, ADMINS.ops.email, 'admin')
    const res = await api.get(base)
    expect(res.status()).not.toBe(403)
    await api.dispose()
  })

  test('assigned PROVIDER GET caregivers → allowed (in-scope patient)', async () => {
    // Every seed patient is on primaryProvider's panel (see 30s happy path),
    // so Priya is in scope — the per-patient check passes and the read returns.
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const priya = await tc.findUser(PATIENTS.priya.email)
    await tc.dispose()
    const api = await authedApi(API_BASE_URL, ADMINS.primaryProvider.email, 'admin')
    const res = await api.get(`admin/patients/${priya.id}/caregivers`)
    expect(res.status(), await res.text()).toBe(200)
    await api.dispose()
  })
})
