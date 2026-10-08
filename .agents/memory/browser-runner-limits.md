---
name: Browser runner limits
description: Managed browser snapshots, clipboard resets, and Clerk auth-fixture limits.
---

Do not let OS clipboard reads block a critical account or room test. A runner
reset is not evidence that the app failed, and unexecuted checks are not passes.

**Why:** A managed-browser clipboard read hung for 45 seconds; the next call
reported a notebook reset that destroyed both authenticated contexts. Core
identity checks had passed, but audio/cleanup checks could not be completed.

**How to apply:** Confirm the value passed to clipboard.writeText instead of
depending on clipboard.readText. Keep synthetic-account recovery information
through runner-supported mechanisms, rather than only notebook variables.
Never put login claims, credentials, or personal identifiers in project memory.

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