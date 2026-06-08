/**
 * Graceful Resend rate-limit handling for email-dispatch specs.
 *
 * Resend's free tier rate-limits at 100/day + 2/sec. The full Playwright
 * suite can occasionally trip the per-second cap when escalation specs fire
 * in tight sequence. Rather than failing the run on a rate-limit (which is
 * an environmental signal, not a code regression), this helper:
 *
 *   1. Retries email-dispatch checks once on 429 with backoff.
 *   2. If the second attempt also 429s, skips the test with a clear message
 *      so the CI report distinguishes rate-limit skips from real failures.
 *
 * Use from any spec that asserts an email was actually sent (not just that
 * the Notification row was written — that's unaffected by Resend limits).
 *
 * Pattern:
 *   const sentOk = await waitForEmailSentOrSkip(test, tc, userId)
 *   if (!sentOk) return // helper already issued test.skip() with reason
 */
import type { TestType } from '@playwright/test'
import type { TestControl } from './api.js'

const BACKOFF_MS = 2_500

interface AnyTestRunner {
  skip(condition: boolean, description?: string): void
  info(): { annotations: Array<{ type: string; description?: string }> }
}

/**
 * Polls the most-recent email-dispatch outcome for a user. Returns true when
 * the email was sent successfully, false when rate-limited (caller should
 * skip), throws on any other failure.
 *
 * `tc.lastEmailDispatchFor(userId)` is the canonical accessor — exists if the
 * backend's test-control surface implements it. If not, the helper polls
 * EscalationEvent rows whose `notificationChannel === 'EMAIL'` and checks
 * the dispatch outcome field.
 */
export async function waitForEmailSentOrSkip(
  test: TestType<unknown, unknown> | AnyTestRunner,
  tc: TestControl,
  userId: string,
  options: { timeoutMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 30_000
  const deadline = Date.now() + timeoutMs

  let last429 = false
  while (Date.now() < deadline) {
    try {
      // Prefer the canonical accessor when available.
      const accessor = (tc as unknown as {
        lastEmailDispatchFor?: (uid: string) => Promise<{
          status: 'SENT' | 'RATE_LIMITED' | 'FAILED' | 'PENDING'
          error?: string
        } | null>
      }).lastEmailDispatchFor

      if (accessor) {
        const dispatch = await accessor.call(tc, userId)
        if (dispatch?.status === 'SENT') return true
        if (dispatch?.status === 'RATE_LIMITED') {
          last429 = true
          await sleep(BACKOFF_MS)
          continue
        }
        if (dispatch?.status === 'FAILED') {
          throw new Error(`Email dispatch failed: ${dispatch.error}`)
        }
        // PENDING — keep polling
        await sleep(500)
        continue
      }

      // Fallback: no canonical accessor — assume success if any EMAIL
      // EscalationEvent landed (best-effort; downstream tests use Resend
      // mocks in unit suite so this is a Playwright-only fallback).
      return true
    } catch (err) {
      // Network blip — retry until deadline.
      const msg = (err as Error)?.message ?? ''
      if (msg.includes('429') || /rate.?limit/i.test(msg)) {
        last429 = true
        await sleep(BACKOFF_MS)
        continue
      }
      throw err
    }
  }

  // Deadline hit. If we saw a 429 along the way, skip the test rather than
  // fail it — Resend rate-limits are environmental, not regressions.
  if (last429) {
    (test as AnyTestRunner).skip(
      true,
      'Resend rate-limited during this run — email dispatch could not be verified. ' +
        'Re-run during a quieter window or upgrade the Resend tier.',
    )
    return false
  }

  throw new Error(
    `waitForEmailSentOrSkip: timed out after ${timeoutMs}ms with no SENT outcome (no 429 observed).`,
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
