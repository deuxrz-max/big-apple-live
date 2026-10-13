---
name: Beam TV video screening
description: Limitations and application of English-language and widescreen filtering for YouTube Beam TV selections.
---

Beam TV uses English/US search settings, rejects non-live videos under 3 minutes, Shorts markers, unverified/non-English language metadata, and non-landscape thumbnail ratios. Saved pools must keep their room-specific trusted-channel rules.

**Why:** Public YouTube video details do not prove spoken language or expose source width/height for videos owned by other channels; thumbnail shape can misrepresent vertical content. A strict metadata filter is safer than presenting guesses as verified.

**How to apply:** Apply the same fail-closed checks to newly selected items and persisted pools. Treat an English language field plus a landscape thumbnail as screening evidence only; never claim the audio itself or true source dimensions were verified without a supported signal.

For nonrepeating topic playback, persist each room's search cursors, candidate pool, and last-played timestamps together; in-memory queues alone reset on server restart. Use a shared daily quota ledger so concurrent refreshes cannot exceed the app's chosen budget.

**Why:** Rebuilding only the queue after a restart repeats the same popular results and loses the history needed to avoid them.

**How to apply:** Keep selection and refresh server-side, read durable play history before each pick, and fall back to the saved pool when the YouTube quota budget is exhausted.
