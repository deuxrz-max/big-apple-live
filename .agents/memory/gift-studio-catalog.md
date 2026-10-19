---
name: Gift Studio catalog activation
description: Keep custom gift media, displayed names, and restorable versions aligned.
---

Saving a processed clip directly to an existing catalog gift should activate that new version immediately and keep the prior active version as a draft backup. The active version's saved name is the source for the catalog label and gift playback; restore/activate actions should switch both name and media together.

The room gift picker must consume the server's active, sendable catalog rather than maintain a built-in-ID allowlist. Custom `studio-*` gifts need the same active status checks and version-specific icon URLs as built-ins.

**Why:** Catalog additions and replacements otherwise save successfully but remain invisible or stale in an already-open room; stable gift IDs must not imply stable media URLs.

**How to apply:** Keep the replacement and prior-version demotion atomic. When changing activation, renaming an active version, or replacing media, refresh catalog data and active-media data; use version-specific media URLs and avoid caching the active-version manifest.
