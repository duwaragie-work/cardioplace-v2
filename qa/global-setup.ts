import { request as pwRequest } from '@playwright/test'

/**
 * Global setup runs once before any project. We use it for two things:
 *   1. Verify the backend is reachable and ENABLE_TEST_CONTROL is on (otherwise
 *      escalation + cron specs will fail with 404, which is a confusing first
 *      failure mode).
 *   2. Reset the test-control state to a known baseline (deletes any
 *      DeviationAlert / EscalationEvent / Notification / JournalEntry rows
 *      written by *.cardioplace.test patient seeds during prior runs).
 *
 * If the suite is run against staging or any non-local env, set
 * SKIP_RESET=1 to retain whatever state already exists.
 */
async function globalSetup(): Promise<void> {
  const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000'
  const secret = process.env.TEST_CONTROL_SECRET
  const ctx = await pwRequest.newContext({
    baseURL: apiBase,
    extraHTTPHeaders: secret ? { 'X-Test-Control-Secret': secret } : {},
  })

  // 1. Reachability check — backend up?
  let healthOk = false
  try {
    const res = await ctx.get('/test-control/health')
    healthOk = res.ok()
  } catch {
    // swallow — handled below
  }

  if (!healthOk) {
    console.warn(
      '\n⚠ /test-control/health is not reachable at ' + apiBase +
        '\n  Confirm backend is running with ENABLE_TEST_CONTROL=true.' +
        '\n  Escalation + cron specs will skip until this resolves.\n',
    )
    await ctx.dispose()
    return
  }

  // 2. Optional reset of test-patient state
  if (process.env.SKIP_RESET !== '1') {
    const reset = await ctx.post('/test-control/reset/test-patients', {
      data: {},
    })
    if (!reset.ok()) {
      console.warn(
        `\n⚠ /test-control/reset/test-patients returned ${reset.status()}. Continuing anyway.\n`,
      )
    }
  }

  await ctx.dispose()
}

export default globalSetup
