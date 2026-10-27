---
name: Room playback rendering budget
description: Keep decorative room motion off the full-screen paint path; distinguish rendering pressure from media/network failures.
---

Room decorations and title motion must not continuously repaint the viewport. Keep gold highlights as small edge-local transform/opacity glints, and promote the room title's repeating transform animation on room screens. Use an A/B trace to distinguish the title from the perimeter instead of assuming either is responsible.

**Why:** CPU-throttled traces attributed repeated viewport paints to the room-title word drift; pausing title animation while leaving the edge light running produced no paints. Promoting the title transform removed the continuing repaint without changing its visible motion. The earlier viewport-sized masked edge layer also produced paint invalidation.

**How to apply:** Use CPU-throttled mobile-viewport Paint/Raster traces, not only requestAnimationFrame timing or visual snapshots, when changing room animation. Do not assume SVG dash or CSS path animation is compositor-only. Preserve shared timing, player lifetime and audio splitting; never change sync tolerances or video quality without separate evidence. Desktop emulation cannot establish the sole cause on a particular real phone or connection.

For responsive card lighting, move a static light layer with transforms rather than updating a radial gradient's center every frame.

**Why:** A throttled browser trace of the owner-only card finish showed substantially more repainting with a pointer-driven gradient center. Moving the same static light layer brought accumulated paint time close to the unchanged-card comparison without changing the existing Joker shimmer.

**How to apply:** Keep textures static and effects card-local, ease pointer updates through animation frames, and recheck paint cost under CPU slowdown. Real Android touch performance, heat and battery use still require device verification.

For card readability, keep the raster face at its native aspect ratio and size; avoid fractional resting scales, scale-based deal/reveal animations, and broad text halos. Confine neon glow to compact frame and glyph edges.

**Why:** The owner reported soft card faces on mobile even though the supplied art was sufficient for the normal hand grid; layered surface light, wide glow, and fractional transforms made details appear washed or resampled.

**How to apply:** Audit effect layers and transforms before replacing card art. Verify the hand at high-density phone dimensions and treat real-device rendering as a separate check.
