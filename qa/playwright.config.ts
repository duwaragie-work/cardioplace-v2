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
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: PATIENT_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    extraHTTPHeaders: {
      'X-Test-Run': '1',
    },
  },
  expect: { timeout: 10_000 },
  globalSetup: './global-setup.ts',
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
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
