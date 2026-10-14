---
name: Transparent media assets
description: Preserve genuine alpha for gift and room-effect media across browsers.
---

The owner confirmed that Moonfox stays transparent in the app.

**Why:** This confirmation reflects a user-visible result that code inspection alone cannot establish.

Green-screen video conversion must be checked on decoded frames and composited against light and dark backgrounds. Do not trust a codec/container alpha flag by itself: FFmpeg may advertise VP9 alpha without exposing it in its decoded pixel format. Entrance effects must remain silent and animated; never fall back to a badge still. Use alpha VP9 WebM on Chromium/Android and one-play animated WebP on Safari, and verify the actual browser composite.

**Why:** The user explicitly requires every entrance effect to be silent and animated, with the badge image reserved for name/profile use. Earlier code showed still badge art when animation playback failed, and the uploaded Lion MP4 had a baked green background.

**How to apply:** Keep uploaded originals untouched, chroma-key silent derivatives, inspect alpha and composites frame-by-frame, and use only animated fallbacks. If the animated formats fail, show no effect rather than a badge still.
