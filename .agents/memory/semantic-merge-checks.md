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

A merged database schema is not proof that the physical database or data backfills
have been updated. Schema synchronization alone does not run application data
migrations.

**Why:** A photo-retention merge left its required columns missing in the running
database. Extending profiles also needed existing main photos preserved in the
new collection, which a schema-only sync cannot do.

**How to apply:** Check the live development schema after merges, apply approved
additive migrations, and include idempotent backfills in post-merge setup. Verify
retention rules against every currently selected photo before enabling cleanup.
