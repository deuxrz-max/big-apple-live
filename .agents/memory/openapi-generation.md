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

Pin the generated Zod and React Query API versions to the consuming runtime rather than relying on auto-detection.

**Why:** The generator runs in a separate workspace package. After an Orval upgrade, version inference did not find the consumer's React Query dependency and silently chose v4 hooks for a v5 consumer. Old Zod-generation settings also degraded validator inference after a runtime major upgrade.

**How to apply:** For generator upgrades, align both output-version settings with their consumers, regenerate from the unchanged contract, then run the whole workspace type check and validator regression tests. Do not hide incompatibilities by importing a legacy Zod runtime.
