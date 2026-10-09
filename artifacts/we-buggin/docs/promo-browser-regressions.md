# Repeatable promo playback regression tests

From the workspace root:

```sh
pnpm --filter @workspace/we-buggin test:playlist
pnpm --filter @workspace/we-buggin test:promo-browser
```

The second command runs Playwright in Chromium. It starts and stops a private,
loopback-only Vite test server on port 4317; no running API, login, credentials,
publication or real account is needed. Leave that port free. It does not reuse
the preview server. Allow about three minutes: it plays the **actual committed
H.264/AAC MP4 uploads at their original speed**, including the 53-second last clip.
It never seeks, sets playback rate, fabricates ended events, substitutes media
fixtures or stubs the player.
The command also typechecks the committed browser config, harness and tests.

## Browser/display requirements

On Replit it automatically selects `/repl/tools/bin/chromium` and starts a fresh
Xvfb display on Linux (ignoring potentially stale `DISPLAY` values). The workspace's
Nix packages include `xorg.xorgserver`. Elsewhere install Xvfb (Linux), or set
`PROMO_USE_DISPLAY=1` to use an existing desktop display. Install the matching
Playwright browser if there is no system Chromium:

```sh
pnpm --filter @workspace/we-buggin exec playwright install chromium
# Optional explicit executable; must support H.264 AND AAC:
PROMO_CHROMIUM_PATH=/path/to/chromium pnpm --filter @workspace/we-buggin test:promo-browser
```

The codec preflight checks `canPlayType` for AVC and AAC and records support and
the browser user agent in report attachments. A browser without either decoder
**fails the default run**, instead of falsely reporting media checks as passes.
The managed test browser previously lacked AVC; the workspace browser supported
these same uploads. Capability declarations alone are not enough: playback
checks also require advancing time, decoded video frames and trusted native
completion events.

For intentionally incomplete runs only:

```sh
# Codec-independent fallback/layout checks; unsupported media tests are skipped.
PROMO_ALLOW_CODEC_SKIP=1 pnpm --filter @workspace/we-buggin test:promo-browser
# No display required, but real tab-visibility check is explicitly skipped.
PROMO_HEADLESS=1 pnpm --filter @workspace/we-buggin test:promo-browser
# Focus an individual test while debugging:
pnpm --filter @workspace/we-buggin test:promo-browser --grep "reduced motion"
```

Do not describe either incomplete mode as a full regression pass. Headless
Chromium leaves background tabs visible. Playwright's normal contexts also force
focus/visibility. The visibility test therefore attaches to a separate native
Chromium default context with the public `connectOverCDP({ noDefaults: true })`
option. The headed/Xvfb run uses actual tab switching and `document.hidden`,
not a patched visibility getter or synthetic visibility event.

## Coverage and isolation

- Ordered natural completion of all four uploads and fourth-to-first wraparound.
- Exactly one stable video DOM element, inline playback, muted entry and no
  native single-clip looping.
- Original `TextChatRoom` sound button: on and off persist over clip changes.
- Real failed media requests skip a broken entry without retrying it on the next
  cycle; four failures remove the player, show the dark background, disable
  sound and leave chat usable.
- Reduced motion prevents media on entry and changing the preference pauses
  an existing video; returning to normal restores playback.
- Hiding the real browser tab pauses time; foregrounding resumes the same clip
  and element.
- 320×568 and 390×844 viewports: title, topic, sound controls, messages and
  composer do not overlap; composer clears fixed bottom navigation. Controls
  are in view and hit-testable; typing stays local and history scrolling does
  not move the header/composer.

`tests/browser/harness.tsx` imports **original** `PromoBackground`,
`UniversityRoom.tsx` (`TextChatRoom`), hooks and production styles. It supplies
only QueryClient and a layout-only navigation shell using the original bottom
navigation CSS (not Clerk's account-dependent navigation component).
`tests/browser/vite.config.ts` returns synthetic join/session/history/SSE/
heartbeat responses. All fixture people are ordinary users, not moderators.
Unexpected API requests fail closed; no API proxy or external-origin traffic
is allowed. The harness refuses to mount on the ordinary preview/production
server; only the isolated test config defines its enabling flag.
Tests neither send messages nor change real profiles, accounts,
messages, rules acknowledgements or moderator roles.

The fault tests abort selected media requests to exercise real browser errors.
They do not replace `play`, `pause`, the reducer, React components or account
hooks. This is a component-in-browser regression suite, **not** live
authentication, device-speaker, physical-keyboard or safe-area hardware testing.
No changes to production behavior are required to run it.

Playwright writes `playwright-report/` and `test-results/` (gitignored). Failures
include screenshots and traces. To open the report:

```sh
pnpm --filter @workspace/we-buggin exec playwright show-report
```
