---
name: Transparent media assets
description: Preserve genuine alpha for gift and room-effect media across browsers.
---

The owner confirmed that Moonfox stays transparent in the app.

**Why:** This confirmation reflects a user-visible result that code inspection alone cannot establish.

Green-screen video conversion must be checked on decoded frames and composited against both light and dark backgrounds. Do not trust a codec/container alpha flag by itself: this workspace's FFmpeg VP9 output advertised alpha while its decoded PNG test frames were opaque. Animated WebP retained per-pixel alpha reliably in the local asset checks; a separate M4A can preserve audio, with a transparent PNG as a last-resort still fallback.

**Why:** The uploaded Lion Entrance MP4 had no alpha channel, and a nominal VP9 alpha output did not survive the available decode check. Verifying actual pixels caught the difference before the opaque/green source could ship.

**How to apply:** Keep uploaded originals untouched, chroma-key derivatives, inspect alpha and composites frame-by-frame, and choose a browser-friendly transparent animation plus separate audio when video alpha cannot be confirmed.
