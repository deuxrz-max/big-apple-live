---
name: Modular OpenAPI generation
description: Orval external-reference allowlists and path/query barrel-name collisions.
---

Configure a narrow local-file external-reference allowlist before generating a modular OpenAPI contract.

**Why:** Orval rejects external references by default and cleans its output folders before failing, temporarily removing previously generated imports.

**How to apply:** Allow only the trusted contract files needed by both client and Zod generation. Regenerate successfully before building artifacts; do not use a wildcard allowlist.

Operations combining path and query inputs, or using inline request bodies, can give a runtime validator and a generated interface the same Params/Body export name.

**Why:** Star-exporting both generated namespaces then raises TS2308 even though generation itself succeeded.

**How to apply:** Explicitly prefer the runtime validator in the backend Zod barrel; keep generated interfaces available in the React client. Do not hand-edit generated files to resolve the collision.
