import { defineConfig } from '@playwright/test';
import { chromiumPath } from './native-browser';

export default defineConfig({
  testDir: '.',
  testMatch: ['chess.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4318', headless: true, launchOptions: { executablePath: chromiumPath(), args: ['--no-sandbox'] }, screenshot: 'only-on-failure' },
  webServer: {
    command: 'pnpm exec vite --config tests/browser/chess-vite.config.ts',
    url: 'http://127.0.0.1:4318/tests/browser/chess-harness.html',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
