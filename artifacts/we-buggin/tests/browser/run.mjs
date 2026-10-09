import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';

// A real display lets Chromium emit real document.visibilitychange events.
// Headless Chromium keeps background tabs visible, so it cannot verify that path.
let display;
try {
  const env = { ...process.env };
  if (env.PROMO_USE_DISPLAY !== '1' && env.PROMO_HEADLESS !== '1' && process.platform === 'linux') {
    display = spawn('Xvfb', ['-displayfd', '1', '-screen', '0', '1280x900x24', '-nolisten', 'tcp']);
    const number = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Xvfb did not start within 10 seconds')), 10_000);
      display.on('error', error => { clearTimeout(timeout); reject(error); });
      display.on('exit', code => { clearTimeout(timeout); reject(new Error(`Xvfb exited (${code})`)); });
      display.stderr.pipe(process.stderr);
      display.stdout.on('data', chunk => {
        output += chunk;
        if (/^\d+\n/.test(output)) { clearTimeout(timeout); resolve(output.trim()); }
      });
    });
    env.DISPLAY = `:${number}`;
  }
  const require = createRequire(import.meta.url);
  const cli = require.resolve('@playwright/test/cli');
  const child = spawn(process.execPath, [cli, 'test', '--config', 'tests/browser/playwright.config.ts', ...process.argv.slice(2)], {
    env, stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => { child.kill(signal); display?.kill(); });
  const [code] = await once(child, 'exit');
  process.exitCode = code ?? 1;
} catch (error) {
  console.error(error.message);
  console.error('Install Xvfb/use an existing DISPLAY, or set PROMO_HEADLESS=1 (visibility test explicitly skipped).');
  process.exitCode = 1;
} finally {
  display?.kill();
}
