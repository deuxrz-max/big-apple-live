---
name: Portrait cutout checks
description: Background-removal limits for portraits with detached decorations.
---

Inspect each cutout against the source on a dark background, including detached
hearts and tears, not just the main face.

**Why:** Background removal can silently discard distant decorations even when
the face and hair are correctly retained.

**How to apply:** Keep the original artwork and restore omitted decorations from
it before accepting the cutout. Do not assume successful processing means all
foreground details survived.

Use workspace-relative input and output paths for the background-removal callback.

**Why:** An absolute temporary path was normalized into a relative path and failed
to resolve even though the shell could read the file.

**How to apply:** Put callback input crops in the workspace; reserve temporary
filesystem paths for shell-only processing and inspection.