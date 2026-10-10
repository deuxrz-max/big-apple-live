---
name: Image review tooling
description: Review-sheet tooling, Sharp composite ordering and VP9 alpha verification.
---

Do not rely on ImageMagick montage's default font when assembling image review sheets; use an explicitly installed font or an annotation-free image arrangement.

**Why:** This workspace's default resolved to an empty font name and montage reported a font-rendering error even though the source images were valid.

**How to apply:** For visual asset reviews, separate contact-sheet tooling errors from actual image-generation or decoding failures.

When composing onto a canvas with Sharp, materialize the composite before resizing the finished image.

**Why:** Sharp can perform resize before compositing even when chained afterward, so a large overlay fails against the newly smaller canvas.

**How to apply:** Composite at the source canvas size into a buffer, then pass that buffer through a separate resize operation. Keep review-sheet failures separate from cutout quality.

Do not infer that a VP9 WebM is opaque solely because ffprobe reports yuv420p.

**Why:** WebM can carry alpha as a separate bitstream with alpha_mode=1; the default FFmpeg decoder may ignore it even when libvpx and the browser preserve transparency.

**How to apply:** Check alpha_mode, decode with libvpx-vp9 explicitly and inspect RGBA values. Verify browser alpha before showing video, with a transparent animated-image fallback for unsupported decoders.

When probing alpha in a browser canvas, crop a source pixel rather than scaling the whole image into a 1×1 destination.

**Why:** Scaling the whole frame averages opaque subject pixels into a sample that was intended to check a transparent corner, producing a false opaque result.

**How to apply:** Use the 9-argument `drawImage` overload to copy a known transparent source corner into the 1×1 test canvas.
