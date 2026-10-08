---
name: Additive schema safety
description: Schema push can surface unrelated constraint/truncation prompts; isolate approved development additions instead.
---

Do not accept an unrelated truncate prompt while applying an additive safety migration.

**Why:** Drizzle schema push proposed truncating an existing university table for a unique-constraint discrepancy during an otherwise additive photo-review update. That operation was not authorized and would threaten retained university histories.

**How to apply:** Inspect the proposed SQL. If schema push mixes unrelated destructive work into the request, stop it and apply only the explicitly approved additive columns in a transaction against development. Never use force to bypass the warning or run schema changes against production.
