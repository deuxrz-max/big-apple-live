---
name: Gift Studio catalog activation
description: Keep custom gift media, displayed names, and restorable versions aligned.
---

Saving a processed clip directly to an existing catalog gift should activate that new version immediately and keep the prior active version as a draft backup. The active version's saved name is the source for the catalog label and gift playback; restore/activate actions should switch both name and media together.

**Why:** The owner expects “save to an existing gift” to replace what people see and play, while still being able to restore the prior animation without changing prices or gift accounting.

**How to apply:** Keep the replacement and prior-version demotion atomic. When changing activation or renaming an active version, refresh catalog and active-media data; use version-specific media URLs and avoid caching the active-version manifest.
