---
name: Room playback rendering budget
description: Keep decorative room motion off the full-screen paint path; distinguish rendering pressure from media/network failures.
---

Room decorations and title motion must not continuously repaint the viewport. Keep gold highlights as small edge-local transform/opacity glints, and promote the room title's repeating transform animation on room screens. Use an A/B trace to distinguish the title from the perimeter instead of assuming either is responsible.

**Why:** CPU-throttled traces attributed repeated viewport paints to the room-title word drift; pausing title animation while leaving the edge light running produced no paints. Promoting the title transform removed the continuing repaint without changing its visible motion. The earlier viewport-sized masked edge layer also produced paint invalidation.

**How to apply:** Use CPU-throttled mobile-viewport Paint/Raster traces, not only requestAnimationFrame timing or visual snapshots, when changing room animation. Do not assume SVG dash or CSS path animation is compositor-only. Preserve shared timing, player lifetime and audio splitting; never change sync tolerances or video quality without separate evidence. Desktop emulation cannot establish the sole cause on a particular real phone or connection.
