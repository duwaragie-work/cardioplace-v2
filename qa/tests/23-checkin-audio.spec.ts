import { test, expect } from '@playwright/test'
import { signInPatient } from '../helpers/auth.js'
import { dismissCheckinGate } from '../helpers/api.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Bug 3 — the check-in AudioButton (silent-literacy TTS) must actually invoke
 * the speech path when clicked. The real failure was environment-dependent
 * (no OS voice / Chrome paused-state silently dropping speak()), so here we
 * stub window.speechSynthesis before the page loads and assert the click
 * reaches speak() with the (non-empty) step audio text. The component fix adds
 * a data-testid, a defensive resume(), an empty-text guard, and dev warnings.
 *
 * No data mutation → no RUN_WRITE_TESTS gate. Mobile viewport (patient-facing).
 */
test.describe('Check-in audio button', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('AudioButton is present on the check-in screen and clicking it invokes speech', async ({ page }) => {
    // Stub SpeechSynthesis BEFORE any page script so AudioButton sees it as
    // supported and our spy records speak() calls. getVoices() returns [] so
    // applyFriendlyVoice leaves the (native) utterance.voice untouched.
    await page.addInitScript(() => {
      const spoken: string[] = []
      ;(window as unknown as { __ttsSpoken: string[] }).__ttsSpoken = spoken
      const stub = {
        getVoices: () => [] as unknown[],
        speak: (u: { text?: string; onend?: () => void }) => {
          spoken.push(u?.text ?? '')
          if (u?.onend) setTimeout(() => u.onend!(), 0)
        },
        cancel: () => {},
        resume: () => {},
        pause: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      }
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        get: () => stub,
      })
    })

    await signInPatient(page, PATIENTS.carol.email)
    await page.goto('/check-in')

    // /check-in may open on a resume/open-session gate instead of step 1 (the
    // AudioButtons live on step 1). Poll past whichever gate is shown.
    await dismissCheckinGate(page)

    const audio = page.locator(byTestId(T.checkin.audioButton)).first()
    await expect(audio).toBeVisible({ timeout: 15_000 })
    await audio.click()

    const spoken = await page.evaluate(
      () => (window as unknown as { __ttsSpoken: string[] }).__ttsSpoken ?? [],
    )
    expect(spoken.length, 'speak() should be invoked on click').toBeGreaterThan(0)
    expect(spoken[0]?.trim().length, 'spoken text is non-empty').toBeGreaterThan(0)
  })
})
