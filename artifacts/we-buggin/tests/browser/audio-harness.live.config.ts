import { defineConfig } from "@playwright/test";
import { chromiumPath } from "./native-browser";

const baseURL = process.env.STREAMTALK_AUDIO_HARNESS_BASE_URL
  ?? "http://localhost:80";

export default defineConfig({
  testDir: ".",
  testMatch: ["audio-harness.live.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 150_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: {
    baseURL,
    headless: true,
    viewport: { width: 390, height: 844 },
    launchOptions: { executablePath: chromiumPath(), args: ["--no-sandbox"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
