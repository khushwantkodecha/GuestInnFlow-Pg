import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for PG-GuestInnFlow frontend.
 *
 * Run tests:
 *   npx playwright test                          # all tests (headless)
 *   npx playwright test --ui                     # interactive UI
 *   npx playwright test --project=financial      # financial tests only (needs backend)
 *   npx playwright test --project=ui             # UI-only tests (mocked backend)
 *
 * Financial tests require BOTH servers running:
 *   - Frontend: npm run dev          (port 3000)
 *   - Backend:  npm run dev (root)   (port 5001)
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',

  /* Fail fast on CI, allow retries locally */
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  /* Reporter */
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    baseURL: 'http://localhost:3000',
    /* Capture trace on first retry to help diagnose CI failures */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    /* Generous timeouts — Vite HMR can be slow on first load */
    navigationTimeout: 15_000,
    actionTimeout:     10_000,
  },

  projects: [
    /* ── UI tests (existing, mocked API) ────────────────────────────────── */
    {
      name:      'ui',
      testMatch: ['**/e2e/properties.spec.ts', '**/e2e/assign-tenant.spec.ts', '**/e2e/rooms-beds.spec.ts', '**/e2e/qa-live.spec.ts'],
      use:       { ...devices['Desktop Chrome'] },
    },

    /* ── Financial tests (real backend required on port 5001) ───────────── */
    {
      name:      'financial',
      testMatch: [
        '**/financial/rent.spec.ts',
        '**/financial/payments.spec.ts',
        '**/financial/charges.spec.ts',
        '**/financial/deposit.spec.ts',
        '**/financial/reservation.spec.ts',
        '**/financial/vacate.spec.ts',
        '**/financial/edgeCases.spec.ts',
        '**/financial/idempotency.spec.ts',
        '**/financial/failures.spec.ts',
        '**/financial/vacateSnapshot.spec.ts',
        '**/financial/concurrency.spec.ts',
        '**/financial/crossValidation.spec.ts',
        '**/financial/systemInvariant.spec.ts',
        '**/financial/simulation.spec.ts',
        '**/financial/fuzz.spec.ts',
        '**/financial/dataSafety.spec.ts',
        '**/financial/uiLock.spec.ts',
      ],
      use: {
        ...devices['Desktop Chrome'],
        /* Financial tests call a real backend — allow more time per operation */
        navigationTimeout: 20_000,
        actionTimeout:     15_000,
      },
      /* Each financial test is fully self-contained with its own DB data,
       * so they can run in parallel. Set to 1 on CI for stability. */
    },

    /* ── Default: run everything ─────────────────────────────────────────── */
    {
      name:      'chromium',
      use:       { ...devices['Desktop Chrome'] },
      /* Exclude financial from default run since they need a live backend */
      testIgnore: '**/financial/**',
    },
  ],

  /* Automatically start the Vite dev server before running tests.
   * Remove this block if you prefer to start the server manually. */
  webServer: {
    command: 'npm run dev',
    port:    3000,
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
