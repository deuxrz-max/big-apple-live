---
name: Room history isolation
description: Privacy rule for recovering chat after room expiry or schema changes.
---

Never attach unbound historical messages to a current room by matching its short
share code. Preserve old unbound rows without exposing them to new memberships.

**Why:** Ephemeral room codes can be reused after expiry or restart, and old rows
without incarnation identity cannot establish which room their members joined.
Guessing a backfill would disclose private conversations to unrelated users.

**How to apply:** Future room recovery or persistent-presence work must preserve
the original room incarnation identifier. Do not backfill pre-incarnation history
by share code, including when migrating existing databases.
