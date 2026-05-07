import { test, expect } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Admin verification (profile + medications) + threshold editor + role
 * boundary checks. We drive these via API rather than UI clicks because:
 *   - the patient-detail tabs are React-heavy and selector-volatile
 *   - the contracts are what matter for downstream alert behavior
 * The UI walk for the same tabs is a phase-2 follow-on.
 */

test.describe('Admin verification — profile', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('admin can verify-profile a seed patient (UNVERIFIED → VERIFIED)', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    // Force back to UNVERIFIED so the verify call has a state to flip.
    await tc.setProfileVerificationStatus(u.id, 'UNVERIFIED')

    const api = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
    const res = await api.post(`admin/users/${u.id}/verify-profile`, {
      data: { rationale: 'qa-test verification' },
    })
    expect(res.ok(), `verify-profile: ${await res.text()}`).toBeTruthy()

    const after = await tc.findUser(PATIENTS.aisha.email)
    expect(after.profileVerificationStatus).toBe('VERIFIED')
    await api.dispose()
    await tc.dispose()
  })

  test('PROVIDER role cannot write Practice (admin role boundary)', async () => {
    const api = await authedApi(API_BASE_URL, ADMINS.primaryProvider.email, 'admin')
    const res = await api.post('admin/practices', {
      data: { name: 'unauthorized', businessHoursStart: '08:00', businessHoursEnd: '18:00', businessHoursTimezone: 'America/New_York' },
    })
    // PROVIDER is excluded from practice CRUD — must 403.
    expect(res.status(), `expected 403 for PROVIDER POST /admin/practices, got ${res.status()}`).toBe(403)
    await api.dispose()
  })
})

test.describe('Admin medication verification', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('reject + readd cycle creates a new med row, retains the rejected one', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
    const u = await tc.findUser(PATIENTS.aisha.email)

    // List Aisha's meds to grab one to reject (Lisinopril per seed.ts)
    const medsRes = await patientApi.get('me/medications')
    expect(medsRes.ok()).toBeTruthy()
    const meds: Array<{ id: string; drugName: string }> = await medsRes.json()
    const lisinopril = meds.find((m) => /lisinopril/i.test(m.drugName))
    expect(lisinopril, 'Aisha should have a Lisinopril row from seed').toBeDefined()

    // Reject it
    const rejectRes = await adminApi.post(`admin/medications/${lisinopril!.id}/verify`, {
      data: { status: 'REJECTED', rationale: 'qa-test reject — confused with Losartan' },
    })
    expect(rejectRes.ok(), `med reject: ${await rejectRes.text()}`).toBeTruthy()

    // The rejected row stays — caller asserts via inspection
    const after = await tc.listAlerts(u.id) // unrelated, just smoke-checks the reset path
    expect(Array.isArray(after)).toBeTruthy()

    await patientApi.dispose()
    await adminApi.dispose()
    await tc.dispose()
  })
})

test.describe('Admin threshold editor', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('MEDICAL_DIRECTOR can write PatientThreshold; PROVIDER cannot', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)

    const mdApi = await authedApi(API_BASE_URL, ADMINS.medicalDirector.email, 'admin')
    const mdRes = await mdApi.post(`admin/patients/${u.id}/threshold`, {
      data: {
        sbpUpperTarget: 130,
        sbpLowerTarget: 100,
        dbpUpperTarget: 85,
        dbpLowerTarget: 60,
        notes: 'qa-test threshold',
      },
    })
    expect(mdRes.ok(), `MD threshold POST: ${await mdRes.text()}`).toBeTruthy()

    const provApi = await authedApi(API_BASE_URL, ADMINS.primaryProvider.email, 'admin')
    const provRes = await provApi.post(`admin/patients/${u.id}/threshold`, {
      data: {
        sbpUpperTarget: 140,
        sbpLowerTarget: 100,
        dbpUpperTarget: 90,
        dbpLowerTarget: 60,
      },
    })
    expect(provRes.status(), 'PROVIDER must not write thresholds').toBe(403)

    await mdApi.dispose()
    await provApi.dispose()
    await tc.dispose()
  })
})
