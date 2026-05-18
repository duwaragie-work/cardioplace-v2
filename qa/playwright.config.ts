import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '.env.local') })
dotenv.config({ path: path.resolve(__dirname, '.env') })

const PATIENT_BASE_URL = process.env.PATIENT_BASE_URL ?? 'http://localhost:3000'
const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL ?? 'http://localhost:3001'
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000'

const fullMatrix = process.env.RUN_FULL_MATRIX === '1'

/**
 * Cardioplace v2 multi-engine Playwright suite.
 *
 * Default: chromium-desktop only (fast PR loop).
 * RUN_FULL_MATRIX=1 → all six combinations (chromium/firefox/webkit × desktop/mobile).
 *
 * Specs select the right baseURL via the project's `use.baseURL`. Patient specs
 * default to PATIENT_BASE_URL; admin specs override per-test via `await page.goto(ADMIN_BASE_URL + '/...')`.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI
    ? [
        ['list'],
        ['json', { outputFile: 'reports/results.json' }],
        // open: 'never' suppresses the HTML reporter's auto-launched
        // local server (port 9323). Without this the playwright CLI hangs
        // after the run completes — `process.env.CI` masks it on GitHub
        // Actions but a local `CI=1 npm run test` would also hang.
        ['html', { open: 'never', outputFolder: 'reports/final' }],
      ]
    : [
        ['list'],
        // Local runs only auto-open the HTML report on test failures so
        // pass-runs return the shell prompt immediately instead of
        // serving a report nobody asked for. open: 'on-failure' = launch
        // the HTML server in the background only when something failed.
        ['html', { open: 'on-failure', outputFolder: 'playwright-report' }],
      ],
  use: {
    baseURL: PATIENT_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    // Emulate the DC Ward 7/8 pilot timezone. The onboarding profile submit
    // sends the browser-derived `Intl…timeZone`; on a UTC host (CI Linux
    // runners) that is literal "UTC", which the backend
    // POST /api/v2/auth/profile DTO rejects with 400 ("timezone must be a
    // valid IANA identifier"), so onboarding never completes (20a.2). Pinning
    // a real IANA zone makes the suite deterministic + matches real pilot
    // users (no DC patient is in literal UTC). NOTE for backend: the
    // profile-DTO arguably should accept "UTC" (it IS a valid IANA zone) —
    // flagged in the PR; non-blocking since the pilot cohort is ET.
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'X-Test-Run': '1',
    },
  },
  expect: { timeout: 10_000 },
  globalSetup: './global-setup.ts',
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        // Sandbox-only: pin to the pre-installed Playwright chromium when the
        // CDN download is blocked. Falls back to PW's own resolution if the
        // env var isn't set.
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
          : {}),
      },
    },
    ...(fullMatrix
      ? [
          {
            name: 'firefox-desktop',
            use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
          },
          {
            name: 'webkit-desktop',
            use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } },
          },
          { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
          { name: 'webkit-mobile', use: { ...devices['iPhone 14'] } },
        ]
      : []),
  ],
})

export { PATIENT_BASE_URL, ADMIN_BASE_URL, API_BASE_URL }
