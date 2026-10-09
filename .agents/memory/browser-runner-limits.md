---
name: Browser runner limits
description: Managed browser snapshots, media codecs, clipboard resets, and Clerk auth-fixture limits.
---

Protected-handler tests need Clerk's complete session-token auth shape, not just
a user ID, as well as the trusted middleware brand.

**Why:** The SDK's accepted-token check treated a user-ID/session-ID-only fixture
as signed out, producing false 401 failures even with correct database roles.

**How to apply:** Reuse an existing current auth fixture rather than inventing
a minimal user-ID mock. Distinguish fixture authentication failures from missing
moderator permissions; do not grant real roles to work around a broken fixture.

Do not let OS clipboard reads block a critical account or room test. A runner
reset is not evidence that the app failed, and unexecuted checks are not passes.

**Why:** A managed-browser clipboard read hung for 45 seconds; the next call
reported a notebook reset that destroyed both authenticated contexts. Core
identity checks had passed, but audio/cleanup checks could not be completed.

**How to apply:** Confirm the value passed to clipboard.writeText instead of
depending on clipboard.readText. Keep synthetic-account recovery information
through runner-supported mechanisms, rather than only notebook variables.
Never put login claims, credentials, or personal identifiers in project memory.

Do not infer broken MP4 assets from a managed browser that lacks their codecs.
The managed browser and workspace Chromium can have different decoder support.

**Why:** Valid H.264/AAC uploads decoded fully with FFmpeg and served correctly,
but the managed browser reported no AVC support. Workspace Chromium played the
same files and completed their natural playlist cycle.

**How to apply:** Check `canPlayType` before diagnosing playback. If the managed
runner lacks the codec, try the workspace browser with the installed Playwright
dependency. Report real media playback separately from mocked room/account data
and physical-device checks; never substitute a test video and call it the upload.

When a reset loses synthetic fixture emails and contexts, create fresh synthetic identities through the supported Clerk testing helper rather than asking the user to recover agent-generated accounts.

**Why:** Fixture profiles can survive in the database while the notebook loses the email variables needed by the sign-in helper. The helper supports arbitrary new test identities.

**How to apply:** Leave old profiles unchanged, use unique fresh fixtures, and keep their recovery details only in runner-supported temporary state.

Runner resets are not limited to clipboard calls. Keep completed browser
observations distinct from unexecuted checks and from server-side test evidence.

**Why:** A runner reset can erase authenticated contexts mid-flow without an app
failure, and passing handler tests do not prove the interrupted browser steps.

**How to apply:** Report browser and server checks separately; never describe a
partial browser run as a full pass.

Treat a current DOM snapshot and a settled screenshot as separate evidence.

**Why:** Avatar test IDs reflected an edited identity while an immediate
screenshot still showed the previous artwork. A focused check of the image URL,
hair geometry, and settled foreground screenshot confirmed the live update.

**How to apply:** Before claiming a visual update, foreground the tested page,
wait for the expected image URL and decoded artwork plus two animation frames,
and compare the pixels with the semantic assertions.

Separate protected-screen verification from real signup verification when the
managed tester uses a Clerk sign-in fixture. Follow the runner's current auth
instructions rather than asking it to submit Clerk signup forms.

**Why:** The managed tester prohibited Clerk UI interactions and permitted only
its `signInClerkUser` fixture. A request to register through the UI was blocked,
even though supported fixture-based sign-in could verify the protected app.

**How to apply:** Use the supported fixture to check signed-in pages and account
profile creation. Verify redirect configuration separately and clearly report
that real signup/email verification was not exercised by the fixture.

Confirm backend authentication immediately after a programmatic login; a
signed-in-looking page is not enough.

**Why:** Synthetic Clerk sessions sometimes showed `/home` or a signed-in UI
while protected API calls returned 401, and could lose the profile route.
An isolated fresh context did not reliably resolve that runner condition.

**How to apply:** Check both the UI session and an authenticated API response
before starting a long protected-flow pass. Try an isolated fixture rather than
changing the app's auth provider or real users. If it still fails, stop auth
retries, report the unexecuted checks, and verify independent components without
claiming full end-to-end success.

The managed test browser may lack H.264 decoding even when the workspace's
`/repl/tools/bin/chromium` supports it. Do not diagnose a missing video element
after fallback as an app rendering failure without checking codec support.

**Why:** The managed runner rejected a valid H.264 asset with
`NotSupportedError` and `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`, while workspace
Chromium decoded it and showed changing rendered frames.

**How to apply:** Check `canPlayType` and capture playback/media errors before
reload in the test browser. Use the capable browser for moving-pixel evidence
and the signed-in runner for layout, controls and fallback checks. Report these
as separate checks rather than claiming the signed-in runner played the video.

For looping MP4s, measure displayed-frame timing at restart separately from
last-to-first image difference. Muted audio can still extend the media timeline.

**Why:** A summer clip had ordinary endpoint image differences but a near-held
final frame, audio extending beyond the video, and measurable browser restart
pauses. Removing audio and re-encoding improved timing without player changes.

**How to apply:** Inspect both stream durations and requestVideoFrameCallback
timing before adding player code. When disabling MP4 edit lists, verify the
first presentation timestamp: B-frame reordering can shift it away from zero.
Do not call native browser looping perfectly gapless solely because loop=true.

Do not infer a broken visibility handler from a normal Playwright page that
never becomes hidden. Its forced focus/visibility can mask real tab behavior
even in headed Chromium.

**Why:** Opening actual sibling tabs under Xvfb still reported visible; disabling
focus emulation through an additional CDP session did not remove Playwright's
original session override. Native Chromium attached without default overrides
did emit the real hidden/visible transitions and pause/resume correctly.

**How to apply:** For real visibility regression checks, use a native browser
default context attached with the supported CDP no-default-overrides option.
Keep this distinct from normal isolated contexts and never patch document.hidden
or fabricate visibility events and then claim real background-tab verification.

When mounting original components in a temporary Vite browser harness, use the
same optimized dependency URLs, including their version query, as the served
source. CommonJS-prebundled React and ReactDOM may expose their APIs on `default`.

**Why:** Bare dynamic dependency imports did not expose ReactDOM's createRoot;
mixing hashed and unhashed imports can also create separate React module instances.

**How to apply:** Inspect the served component's import URLs, match them in the
harness, and use the appropriate default export. Keep synthetic API responses
clearly separated from real authenticated end-to-end evidence.

Use the tenant's actual password policy for persistent preview test accounts,
not the Clerk SDK's documented default minimum. This tenant reported a
15-character minimum when creating development users.

**Why:** A 12-character recommendation was insufficient; the backend validation
response exposed the configured minimum. The policy is remote and not in app code.

**How to apply:** Request a strong secret of at least 16 characters for these
accounts. If validation still fails, inspect sanitized provider error messages
instead of repeatedly guessing or bypassing the password checks.

Stream-copying AAC can slightly change the reported MP4 duration without
changing the audio content. Do not treat a sub-millisecond mux rounding
difference alone as evidence that a clip was trimmed.

**Why:** A mobile serving conversion preserved identical compressed AAC packet
hashes and every video frame, while one reported duration moved by 0.045 ms.

**How to apply:** Check frame counts, video timing and audio packet identity
alongside reported durations when verifying that full uploaded clips survive
optimization. Investigate material timing differences rather than requiring
decimal-string equality across different muxes.
