import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { waitForAlerts } from '../helpers/api.js'

/**
 * H5 G.4 — escalation T+0 patient PUSH row must NOT mirror into the patient
 * Notifications tab.
 *
 * Bug (Duwaragie 2026-06-04): an emergency-class alert (e.g. Aisha 185/125 →
 * BP_LEVEL_2) lists PATIENT as a T+0 escalation recipient on PUSH+EMAIL+
 * DASHBOARD. The DASHBOARD row was already suppressed (F12) and EMAIL was
 * already filtered from the bell (#80), but the PATIENT PUSH Notification row
 * still rendered in the Notifications tab — the alert was already in the Alerts
 * tab, so this was a mirror.
 *
 * Fix (G.4): READ-SIDE filter — getNotifications excludes alert-linked PUSH
 * rows. The PUSH row is still WRITTEN (future-push hook) and the patient EMAIL
 * still SENDS; only the in-app bell list hides the alert-linked PUSH row.
 *
 * This spec fires a real BP_LEVEL_2 alert, confirms the alert-linked patient
 * PUSH Notification row EXISTS in the DB (write path intact), then asserts the
 * patient-facing notifications API + the Notifications tab both exclude it,
 * while the alert itself is visible in the Alerts tab.
 */
test.describe('G.4 — emergency alert does not mirror into the patient Notifications tab', () => {
  test.use({ viewport: { width: 1280, height: 800 }, actionTimeout: 60_000, navigationTimeout: 60_000 })
  test.setTimeout(180_000)

  test('BP_LEVEL_2 → Alerts tab shows it; alert-linked patient PUSH row is hidden from Notifications tab + API', async ({ page }) => {
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000'
    const tc = await newTestControl(apiBase, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)

    const api = await authedApi(apiBase, PATIENTS.aisha.email, 'patient')

    // ── Fire a real emergency alert (185/125) ──────────────────────────────
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

    // ── DB: the emergency alert exists, patient is a T+0 recipient ─────────
    const alerts = await waitForAlerts(tc, aisha.id, (xs) =>
      xs.some((a) => a.status === 'OPEN' && a.tier?.startsWith('BP_LEVEL_2')),
    )
    const emergency = alerts.find((a) => a.tier?.startsWith('BP_LEVEL_2'))!
    expect(emergency, 'an emergency BP_LEVEL_2 alert fired').toBeDefined()

    // Poll the raw notification rows for the escalation T+0 patient PUSH mirror.
    let alertLinkedPush: { id: string; channel: string; alertId: string | null } | undefined
    for (let i = 0; i < 20; i++) {
      const notifs = await tc.listNotifications(aisha.id)
      alertLinkedPush = notifs.find((n) => n.channel === 'PUSH' && n.alertId === emergency.id)
      if (alertLinkedPush) break
      await page.waitForTimeout(1000)
    }
    // The WRITE path is untouched (G.4 is read-side): the PUSH row exists in DB.
    expect(
      alertLinkedPush,
      'escalation T+0 wrote the patient PUSH Notification row (write path intact)',
    ).toBeDefined()

    // ── API: the patient-facing notifications endpoint EXCLUDES that row ───
    const notifRes = await api.get('daily-journal/notifications')
    expect(notifRes.status()).toBe(200)
    const body = (await notifRes.json()) as { data: Array<{ id: string }> }
    const ids = body.data.map((n) => n.id)
    expect(ids, 'alert-linked PUSH row is filtered out of the bell list (G.4)').not.toContain(
      alertLinkedPush!.id,
    )

    // ── UI: alert in the Alerts tab; NOT a row in the Notifications tab ────
    await signInPatient(page, PATIENTS.aisha.email)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await page.locator('[data-testid="notification-bell"]').click()
    await page.waitForURL(/\/notifications/, { timeout: 30_000 })
    await page.waitForLoadState('networkidle').catch(() => {})

    // Alerts top-tab (default): the emergency alert card is visible.
    await page.locator('[data-testid="notifications-tab-alerts"]').click().catch(() => {})
    await expect(
      page.locator(`[data-testid="notification-row-${emergency.id}"]`),
    ).toBeVisible({ timeout: 15_000 })

    // Notifications top-tab: the alert-linked PUSH row must NOT be present.
    await page.locator('[data-testid="notifications-tab-notifications"]').click()
    await page.waitForLoadState('networkidle').catch(() => {})
    await expect(
      page.locator(`[data-testid="notification-row-${alertLinkedPush!.id}"]`),
    ).toHaveCount(0)
  })
})
