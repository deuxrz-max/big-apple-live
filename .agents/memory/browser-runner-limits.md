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