---
name: Image review tooling
description: ImageMagick review-sheet fonts and Sharp resize/composite ordering.
---

Do not rely on ImageMagick montage's default font when assembling image review sheets; use an explicitly installed font or an annotation-free image arrangement.

**Why:** This workspace's default resolved to an empty font name and montage reported a font-rendering error even though the source images were valid.

**How to apply:** For visual asset reviews, separate contact-sheet tooling errors from actual image-generation or decoding failures.

When composing onto a canvas with Sharp, materialize the composite before resizing the finished image.

**Why:** Sharp can perform resize before compositing even when chained afterward, so a large overlay fails against the newly smaller canvas.

**How to apply:** Composite at the source canvas size into a buffer, then pass that buffer through a separate resize operation. Keep review-sheet failures separate from cutout quality.
