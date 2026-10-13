---
name: Beam TV video screening
description: Limitations and application of English-language and widescreen filtering for YouTube Beam TV selections.
---

Beam TV uses English/US search settings, a 4–20 minute duration filter for non-live videos, and rejects Shorts markers in titles, descriptions, or tags plus explicit non-English language metadata. Thumbnail aspect is only a fallback signal: YouTube exposes actual file dimensions only to the video owner.

**Why:** Public YouTube video details do not prove spoken language or expose source width/height for videos owned by other channels; thumbnail shape can misrepresent vertical content.

**How to apply:** Keep the filters consistent across generic topics and special feeds; describe them as best-effort metadata screening, and do not claim true audio-language or source-aspect verification without owner access or another supported signal.

For nonrepeating topic playback, persist each room's search cursors, candidate pool, and last-played timestamps together; in-memory queues alone reset on server restart. Use a shared daily quota ledger so concurrent refreshes cannot exceed the app's chosen budget.

**Why:** Rebuilding only the queue after a restart repeats the same popular results and loses the history needed to avoid them.

**How to apply:** Keep selection and refresh server-side, read durable play history before each pick, and fall back to the saved pool when the YouTube quota budget is exhausted.
