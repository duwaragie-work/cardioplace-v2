import { type Page } from '@playwright/test'
import { byTestId, T } from './selectors.js'

/**
 * Part 1 — drive the patient check-in wizard to submit ONE reading. With the FE
 * buffer it lands on the review screen (held on-device), NOT the backend.
 * Dismisses pre-wizard prompts, answers every medication, optionally reports
 * symptoms.
 */
export async function bufferReadingViaWizard(
  page: Page,
  reading: { systolic: number; diastolic: number; heartRate: number; symptoms?: string[] },
): Promise<void> {
  const visible = (sel: string) =>
    page.locator(byTestId(sel)).first().isVisible().catch(() => false)
  for (let step = 0; step < 16; step++) {
    if (await visible('checkin-startnew-btn')) {
      await page.locator(byTestId('checkin-startnew-btn')).click()
      await page.waitForTimeout(200)
      continue
    }
    if (await visible(T.checkin.newSession)) {
      await page.locator(byTestId(T.checkin.newSession)).click()
      await page.waitForTimeout(200)
      continue
    }
    if (await visible(T.checkin.systolic)) {
      await page.locator(byTestId(T.checkin.systolic)).fill(String(reading.systolic))
      await page.locator(byTestId(T.checkin.diastolic)).fill(String(reading.diastolic))
      await page.locator(byTestId(T.checkin.pulse)).fill(String(reading.heartRate))
      await page.locator(byTestId('check-in-position-sitting')).click().catch(() => {})
    }
    const medYes = page.locator(byTestId(T.checkin.medicationYes))
    const medCount = await medYes.count().catch(() => 0)
    for (let m = 0; m < medCount; m++) await medYes.nth(m).click().catch(() => {})
    for (const s of reading.symptoms ?? []) {
      const loc = page.locator(byTestId(`check-in-symptom-${s}`)).first()
      if (await loc.isVisible().catch(() => false)) await loc.click().catch(() => {})
    }
    if (await visible(T.checkin.submit)) {
      await page.locator(byTestId(T.checkin.submit)).click()
      break
    }
    if (await visible(T.checkin.next)) {
      await page.locator(byTestId(T.checkin.next)).click()
      await page.waitForTimeout(300)
      continue
    }
    await page.waitForTimeout(300)
  }
}

/** Tap "I'm good — send" on the review screen to commit the buffered sitting. */
export async function commitBuffer(page: Page): Promise<void> {
  await page.locator(byTestId('checkin-buffer-im-good')).click()
}
