---
name: Image review tooling
description: ImageMagick contact-sheet font defaults in this workspace.
---

Do not rely on ImageMagick montage's default font when assembling image review sheets; use an explicitly installed font or an annotation-free image arrangement.

**Why:** This workspace's default resolved to an empty font name and montage reported a font-rendering error even though the source images were valid.

**How to apply:** For visual asset reviews, separate contact-sheet tooling errors from actual image-generation or decoding failures.
