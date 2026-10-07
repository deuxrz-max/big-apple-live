---
name: Artifact command environment
description: Distinguish managed workflow environment from ad-hoc shell verification.
---

Managed artifact runtime variables are scoped to the service workflow; an
ad-hoc shell build may not inherit them even when preview works.

**Why:** One-off builds failed for missing service routing variables while
the managed preview built and served successfully.

**How to apply:** Inspect the existing artifact/run configuration and reproduce
its non-secret routing context for the one-off command. Do not change a working
manifest, hardcode a new port, or request credentials in response to a shell-only
missing-variable failure.
