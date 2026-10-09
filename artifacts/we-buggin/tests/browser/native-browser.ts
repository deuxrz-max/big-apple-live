import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from '@playwright/test';

export function chromiumPath() {
  return process.env.PROMO_CHROMIUM_PATH ||
    (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : chromium.executablePath());
}

/** Playwright forces focus/visibility in normal contexts. For the visibility
 * test only, attach to a native browser's default context without overrides.
 * This is public connectOverCDP(noDefaults) API, not a patched DOM/player.
 */
export async function nativeVisibilityBrowser() {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'promo-native-chromium-'));
  const process = spawn(chromiumPath(), [
    '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browser: Browser | undefined;
  const cleanup = async () => {
    await browser?.close();
    if (process.exitCode === null && process.signalCode === null) {
      const exited = once(process, 'exit');
      const timeout = setTimeout(() => process.kill('SIGKILL'), 5000);
      process.kill();
      await exited;
      clearTimeout(timeout);
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Native Chromium did not expose CDP within 15s')), 15_000);
      process.once('error', error => { clearTimeout(timeout); reject(error); });
      process.once('exit', code => { clearTimeout(timeout); reject(new Error(`Native Chromium exited (${code})`)); });
      process.stderr.on('data', chunk => {
        output = (output + chunk).slice(-10_000);
        const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(output);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();
    return {
      page, context,
      close: cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
