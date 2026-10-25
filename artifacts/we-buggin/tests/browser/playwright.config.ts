import { defineConfig } from '@playwright/test';
import { chromiumPath } from './native-browser';

export default defineConfig({
  testDir: '.',
  testMatch: ['audit-fixes.spec.ts', 'access-error.spec.ts', 'promo.spec.ts', 'credits.spec.ts', 'gifts.spec.ts', 'gift-sizing.spec.ts', 'badges.spec.ts', 'gifting-levels.spec.ts', 'room-playback.spec.ts', 'room-feed.spec.ts', 'live-layout.spec.ts', 'profile-navigation.spec.ts', 'profile-cleanup.spec.ts', 'photo-review-page.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000, // The complete uploaded playlist lasts about 77 seconds.
  expect: { timeout: 12_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4317',
    headless: process.env.PROMO_HEADLESS === '1',
    launchOptions: { executablePath: chromiumPath(), args: ['--no-sandbox'] },
    reducedMotion: 'no-preference',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm exec vite --config tests/browser/vite.config.ts',
    url: 'http://127.0.0.1:4317/tests/browser/harness.html',
    reuseExistingServer: false, // Never connect this suite to a real app/API.
    timeout: 60_000,
  },
});
