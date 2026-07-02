import { test, expect } from '@playwright/test'
import { signInAdmin, authedApi } from '../helpers/auth.js'
import { ADMINS, SEED_PRACTICE_ID } from '../helpers/accounts.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Spec 70 — MEDICAL_DIRECTOR practice-scoped admin authority (2026-07-01).
 *
 * Per docs/ACCESS_SCOPE.md §3.2 + Manisha 2026-06-12 Q2, a MED_DIR gains
 * practice-manager-analogue authority for practices they HEAD:
 *   ALLOWED (scoped) → GET /admin/users, PATCH their practice config,
 *                      create care-team assignments for their practice.
 *   DENIED (org-level) → permanent-close, practice create/delete.
 *
 * The seed MED_DIR (medical-director@cardioplace.test / Dr. Priya Raman) heads
 * seed-cedar-hill (backend/prisma/seed/patients.ts). Assertions are API-level
 * (the RolesGuard + PatientAccessService scope check is the real boundary),
 * plus one UI check that the Users nav is now reachable. None of these calls
 * mutate seed state (guards reject before the handler, or the write is a
 * read-then-write-back no-op restored in finally).
 */
test.describe('Spec 70 — MED_DIR admin authority', () => {
  const mdLanding = /\/(dashboard|users|patients)/

  test('70.1 — MED_DIR CAN reach /users (new roster authority)', async ({ page }) => {
    test.setTimeout(90_000)
    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL, mdLanding)
    await page.goto(`${ADMIN_BASE_URL}/users`)
    await expect(page.locator(byTestId(T.adminUsers.inviteSingle))).toBeVisible({
      timeout: 25_000,
    })
    await expect(page.locator(byTestId(T.adminUsers.accessDenied))).toHaveCount(0)
  })

  test('70.2 — MED_DIR API: scoped authority + org-level denials', async ({}, testInfo) => {
    testInfo.setTimeout(90_000)
    const api = await authedApi(API_BASE_URL, ADMINS.medicalDirector.email, 'admin')
    try {
      // Roster read — now allowed (scoped server-side to their practice).
      const users = await api.get('admin/users?limit=1')
      expect(users.status(), 'GET /admin/users allowed for MED_DIR').toBe(200)

      // Practice config edit for a practice they head — read then write the
      // same name back so the assertion proves reachability without mutating
      // seed state.
      const detail = await api.get(`admin/practices/${SEED_PRACTICE_ID}`)
      expect(detail.status(), 'GET own practice detail').toBe(200)
      const currentName: string = (await detail.json()).data.name
      const patch = await api.patch(`admin/practices/${SEED_PRACTICE_ID}`, {
        data: { name: currentName },
      })
      expect(patch.status(), 'PATCH own practice config allowed').toBe(200)

      // Care-team assignment for their own practice — RolesGuard + scope pass,
      // handler runs and 404s on the fake patient (proves reachability, not a
      // role 403).
      const assign = await api.post(
        'admin/patients/qa-nonexistent-patient/assignment',
        {
          data: {
            practiceId: SEED_PRACTICE_ID,
            primaryProviderId: 'qa-a',
            backupProviderId: 'qa-b',
            medicalDirectorId: 'qa-c',
          },
        },
      )
      expect(assign.status(), 'MED_DIR reaches assignment handler for own practice').toBe(404)

      // Org-level actions stay denied at the guard.
      const close = await api.post(
        'admin/users/qa-nonexistent-user/permanent-close',
        { data: { confirmDisplayId: 'QA', reason: 'x' } },
      )
      expect(close.status(), 'MED_DIR permanent-close forbidden').toBe(403)

      const create = await api.post('admin/practices', {
        data: { name: 'QA MD should-403' },
      })
      expect(create.status(), 'MED_DIR create-practice forbidden').toBe(403)
    } finally {
      await api.dispose()
    }
  })
})
