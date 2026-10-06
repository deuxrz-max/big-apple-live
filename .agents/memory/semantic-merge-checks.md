---
name: Semantic merge checks
description: Verify unmarked auto-merged code and completed safety work after a rebase.
---

Do not treat files without conflict markers as validated after a semantic merge.
Compare the final behavior with the completed work before finishing integration.

**Why:** An automatic merge silently removed method braces, mixed route body
schemas, duplicated handlers, and replayed an older implementation without its
finished privacy fixes.

**How to apply:** Regenerate shared clients from the combined contract, typecheck
all artifacts, and run focused regressions for previously completed privacy and
account-switch guarantees. Preserve newer features without dropping those fixes.

Shared room events are not all presence events. Media teardown must ignore chat and visual notifications and react only to roster snapshots or room expiry.

**Why:** Treating a non-roster event as an empty roster disconnects every audio peer whenever a message or a room-mood update arrives.

**How to apply:** When adding event types, check subscribers that derive membership or revoke connections. A new notification must not imply that anyone left.
