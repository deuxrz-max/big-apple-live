---
name: Room playback rendering budget
description: Keep decorative room motion off the full-screen paint path; distinguish rendering pressure from media/network failures.
---

Room decorations must not continuously repaint the viewport. Preserve the black/gold design with a small transform-animated light clipped to a static rim, without a JavaScript per-frame loop. Treat changes to decorative effects as potential video-performance changes even if no gift is playing.

**Why:** Paint tracing reproduced heavy idle-room raster work from the moving gold frame independently of YouTube or gifting. A CSS motion-path alternative also repainted in Chromium; transform-only animation substantially reduced the measured paint work. A normal-speed requestAnimationFrame test had not exposed the cost.

**How to apply:** Use CPU-throttled mobile-viewport Paint/Raster traces, not only requestAnimationFrame timing or visual snapshots, when changing room animation. Do not assume SVG dash or CSS path animation is compositor-only. Preserve shared timing, player lifetime and audio splitting; never change sync tolerances or video quality without separate evidence. Desktop emulation cannot establish the sole cause on a particular real phone or connection.
