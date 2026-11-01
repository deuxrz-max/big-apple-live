---
name: Beam TV video screening
description: Limitations and application of English-language and widescreen filtering for YouTube Beam TV selections.
---

Beam TV uses English/US search settings, rejects non-live videos under 3 minutes, Shorts markers, unverified/non-English language metadata, and non-landscape thumbnail ratios. Saved pools must keep their room-specific trusted-channel rules.

**Why:** Public YouTube video details do not prove spoken language or expose source width/height for videos owned by other channels; thumbnail shape can misrepresent vertical content. A strict metadata filter is safer than presenting guesses as verified.

**How to apply:** Apply the same fail-closed checks to newly selected items and persisted pools. Treat an English language field plus a landscape thumbnail as screening evidence only; never claim the audio itself or true source dimensions were verified without a supported signal.

For this adults-only app, leave YouTube `safeSearch` disabled (`none`) and do not add made-for-kids or family-friendly topic filters. Continue rejecting videos YouTube marks age-restricted or non-embeddable.

**Why:** The owner explicitly wants topic-matched videos from the full adult range; age-restricted and unembeddable videos still cannot reliably play in the embedded player.

**How to apply:** Set `safeSearch=none` on every YouTube search flow and preserve only playback, language, aspect-ratio, duration, region, and room-specific source checks that are independently required.

For nonrepeating topic playback, persist each room's search cursors, candidate pool, and last-played timestamps together; in-memory queues alone reset on server restart. Use a shared daily quota ledger so concurrent refreshes cannot exceed the app's chosen budget.

Harlem is an exception to the former combined Sports/Pro Wrestling feed: use only official YouTube searches for `#BiggJah`, `#ComedySkits` and `#FunnyVideos`, with its own saved rotation refreshed about daily. Never fall back to the old source pools or search on room entry.

**Why:** The owner explicitly replaced Harlem's rotation while requiring every other room and the original video storage to remain untouched.

**How to apply:** Keep Harlem separate from the generic source-pool sanitizer/refiller. Require embeddable, non-age-restricted, region-playable results with valid duration, deduplicate and retain hashtag provenance. Use only the official embedded player, with creator attribution or a YouTube link; never download or re-host videos.

**Why:** Rebuilding only the queue after a restart repeats the same popular results and loses the history needed to avoid them.

**How to apply:** Keep selection and refresh server-side, read durable play history before each pick, and fall back to the saved pool when the YouTube quota budget is exhausted.

The Music room only accepts YouTube Music-category results with an official-video title marker and a VEVO channel or artist/channel-name match; reactions, reviews, interviews, tutorials, podcasts, lyric/audio uploads, compilations, covers, and live performances are excluded.

**Why:** The owner wants official artist music videos, not general music-related content. YouTube's public video API does not expose a reliable verified-artist flag, so this is a strict best-effort provenance check rather than proof of channel ownership.

**How to apply:** Keep the category and title/channel checks on both new results and saved Music entries. Describe channel provenance as screened by metadata, not independently verified.

The Movies room must use only configured official/licensed distributor channels and complete-film titles with a runtime of at least 60 minutes. Never fall back to generic trailers, clips, commentary, recaps, or explained videos.

**Why:** The owner wants full movies, not movie-related discussion or promotional material, and specifically wants to avoid likely pirated re-uploads.

**How to apply:** Enforce the trusted channel allow-list and full-film/runtime checks for both newly found videos and persisted pools. Fallback searches must still be limited to the approved channels.
