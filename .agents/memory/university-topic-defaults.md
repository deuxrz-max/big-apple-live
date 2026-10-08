---
name: University topic defaults
description: Why the initial topic rollout avoids backfilling existing university records.
---

Use the supplied initial university topics as defaults for empty nullable topic
fields, rather than a startup backfill of existing records.

**Why:** The owner authorized only additive Phase 3 schema changes and explicitly
required that existing database data not be deleted or rewritten. The default
mapping introduces topics without changing existing records.

**How to apply:** Preserve stored topic overrides and resolve overflow topics from
the parent university. Do not introduce recurring startup updates without approval.
