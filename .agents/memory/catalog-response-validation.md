---
name: Catalog response validation
description: Catalog removals can break signed-in pages through generated response validators.
---

When changing a configurable catalog, check every API response constraint that embeds it. Do not require a fixed array count for owner-preview tier settings.

**Why:** Removing two recharge tiers left a five-item constraint in the OpenAPI contract. The three-tier owner response then failed validation and returned 500 from the shared signed-in profile endpoint, blocking multiple pages despite passing catalog and type checks.

**How to apply:** Update the source contract and regenerate validators and clients together. Regression-test the actual generated profile response schema with both owner-preview settings and ordinary-account settings; catalog-only tests do not cover this failure.
