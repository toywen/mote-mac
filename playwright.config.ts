import { defineConfig } from '@playwright/test'

const ci = !!process.env.CI

export default defineConfig({
  testDir: 'tests/e2e',
  // A committed test.only would skip the rest of the suite and still pass.
  forbidOnly: ci,
  // CI uploads playwright-report with test-results when a run fails.
  reporter: ci ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list'
})
