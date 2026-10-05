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
