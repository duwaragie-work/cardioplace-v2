import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { waitForAlerts } from '../helpers/api.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Notification bell tab-split — dispatchTrigger discriminator
 * (project_notification_tab_split_2026_06_04).
 *
 * The bell keys "is this an alert?" off `dispatchTrigger`, not the nullable
 * `alertId`. This covers the two things spec 22 does not:
 *   A. The DELETE-READING orphan path. Deleting the reading hard-deletes its
 *      DeviationAlert (cascade), which SetNull-nulls `alertId` on the surviving
 *      Notification. Under the old alertId heuristic that orphan LEAKED into the
 *      patient bell; keyed off dispatchTrigger it stays hidden.
 *   B. The ADMIN bell. Admin bell + /admin/notifications pull from the SAME
 *      GET /api/daily-journal/notifications endpoint, so the same ALERT_* hide
 *      applies to a provider's escalation notifications.
 *
 * Requires the full stack (backend :4000 with ENABLE_TEST_CONTROL, patient
 * :3000). Playwright is the CI gate (reference_ci_no_backend_jest).
 */
test.describe('Notification tab-split — dispatchTrigger discriminator', () => {
  test.use({ viewport: { width: 1280, height: 800 }, actionTimeout: 60_000, navigationTimeout: 60_000 })
  test.setTimeout(180_000)

  const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000'

  test('A — delete-reading orphans the alert notification; it stays HIDDEN from the patient bell', async ({ page }) => {
    const tc = await newTestControl(apiBase, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    await tc.setEnrollment(aisha.id, 'ENROLLED')

    const api = await authedApi(apiBase, PATIENTS.aisha.email, 'patient')

    // Fire a real BP_LEVEL_2 emergency (185/125).
    const trigger = await api.post('daily-journal', {
      data: {
        measuredAt: new Date().toISOString(),
        systolicBP: 185,
        diastolicBP: 125,
        pulse: 92,
        position: 'SITTING',
        sessionId: randomUUID(),
      },
    })
    expect(trigger.status(), `POST failed: ${await trigger.text()}`).toBe(202)

    const alerts = await waitForAlerts(tc, aisha.id, (xs) =>
      xs.some((a) => a.status === 'OPEN' && a.tier?.startsWith('BP_LEVEL_2')),
    )
    const emergency = alerts.find((a) => a.tier?.startsWith('BP_LEVEL_2'))!
    expect(emergency).toBeDefined()

    // Fire T+0 so the alert-linked patient PUSH row exists.
    await tc.fireEscalationT0(emergency.id)

    let alertNotif: { id: string; alertId: string | null } | undefined
    for (let i = 0; i < 20; i++) {
      const notifs = await tc.listNotifications(aisha.id)
      alertNotif = notifs.find((n) => n.channel === 'PUSH' && n.alertId === emergency.id)
      if (alertNotif) break
      await page.waitForTimeout(1000)
    }
    expect(alertNotif, 'escalation T+0 wrote the alert-linked patient PUSH row').toBeDefined()

    // Resolve the reading id (resetUser wiped history, so this is the only
    // entry) and DELETE it — hard delete → cascade deletes the alert →
    // onDelete:SetNull nulls alertId on the notification (the orphan).
    const readingsRes = await api.get('daily-journal')
    const readings = ((await readingsRes.json()) as { data: Array<{ id: string; systolicBP: number }> }).data
    const reading = readings.find((r) => r.systolicBP === 185) ?? readings[0]
    expect(reading, 'the fired reading is retrievable').toBeTruthy()
    const del = await api.delete(`daily-journal/${reading.id}`)
    expect(del.status(), `DELETE failed: ${await del.text()}`).toBe(200)

    // The notification row survives but is now orphaned (alertId null).
    let orphaned = false
    for (let i = 0; i < 20; i++) {
      const notifs = await tc.listNotifications(aisha.id)
      const row = notifs.find((n) => n.id === alertNotif!.id)
      if (row && row.alertId === null) {
        orphaned = true
        break
      }
      await page.waitForTimeout(1000)
    }
    expect(orphaned, 'the alert cascade nulled alertId on the surviving notification').toBe(true)

    // API: the orphan is excluded from the bell (would have LEAKED under the old
    // alertId != null AND PUSH heuristic, which no longer holds once alertId is null).
    const notifRes = await api.get('daily-journal/notifications')
    expect(notifRes.status()).toBe(200)
    const body = (await notifRes.json()) as { data: Array<{ id: string }> }
    expect(body.data.map((n) => n.id)).not.toContain(alertNotif!.id)

    // UI: the orphan is absent from the patient Notifications tab.
    await signInPatient(page, PATIENTS.aisha.email)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await page.goto('/notifications')
    await page.locator(byTestId(T.notifications.tabNotifications)).click().catch(() => {})
    await page.waitForLoadState('networkidle').catch(() => {})
    await expect(page.locator(`[data-testid="notification-row-${alertNotif!.id}"]`)).toHaveCount(0)
  })

  test('B — a provider escalation notification is HIDDEN from the admin bell while the alert stays in the system', async () => {
    const tc = await newTestControl(apiBase, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    const provider = await tc.findUser(ADMINS.primaryProvider.email)
    await tc.resetUser(aisha.id)
    await tc.setEnrollment(aisha.id, 'ENROLLED')

    const patientApi = await authedApi(apiBase, PATIENTS.aisha.email, 'patient')
    const trigger = await patientApi.post('daily-journal', {
      data: {
        measuredAt: new Date().toISOString(),
        systolicBP: 186,
        diastolicBP: 124,
        pulse: 90,
        position: 'SITTING',
        sessionId: randomUUID(),
      },
    })
    expect(trigger.status(), `POST failed: ${await trigger.text()}`).toBe(202)

    const alerts = await waitForAlerts(tc, aisha.id, (xs) =>
      xs.some((a) => a.status === 'OPEN' && a.tier?.startsWith('BP_LEVEL_2')),
    )
    const emergency = alerts.find((a) => a.tier?.startsWith('BP_LEVEL_2'))!
    await tc.fireEscalationT0(emergency.id)

    // The assigned provider receives an alert-linked DASHBOARD notification.
    let provNotif: { id: string } | undefined
    for (let i = 0; i < 20; i++) {
      const notifs = await tc.listNotifications(provider.id)
      provNotif = notifs.find((n) => n.channel === 'DASHBOARD' && n.alertId === emergency.id)
      if (provNotif) break
      await new Promise((r) => setTimeout(r, 1000))
    }
    expect(provNotif, 'the T+0 ladder wrote a provider DASHBOARD notification').toBeDefined()

    // Admin bell = GET /api/daily-journal/notifications for the provider. The
    // alert-class row is excluded (it belongs in the alert dashboard, not the bell).
    const providerApi = await authedApi(apiBase, ADMINS.primaryProvider.email, 'admin')
    const bell = await providerApi.get('daily-journal/notifications')
    expect(bell.status()).toBe(200)
    const bellBody = (await bell.json()) as { data: Array<{ id: string }> }
    expect(bellBody.data.map((n) => n.id)).not.toContain(provNotif!.id)

    // The alert itself is still live in the system (the Alerts stream source),
    // not deleted — only its bell mirror is suppressed.
    const stillOpen = await waitForAlerts(tc, aisha.id, (xs) =>
      xs.some((a) => a.id === emergency.id && a.status === 'OPEN'),
    )
    expect(stillOpen.some((a) => a.id === emergency.id)).toBe(true)
  })
})
