---
name: Beam TV video screening
description: Limitations and application of English-language and widescreen filtering for YouTube Beam TV selections.
---

Beam TV searches request English relevance and the US region, reject explicit non-English language metadata and clearly non-English titles, and require a widescreen thumbnail signal while rejecting portrait thumbnail variants. YouTube Data API metadata does not prove the spoken audio language or the source video's actual frame dimensions.

**Why:** The user requested English, landscape-only programming, but the API exposes language hints and thumbnails rather than authoritative audio and source-dimension guarantees.

**How to apply:** Keep the filters consistent across generic topics and special feeds; describe them as best-effort metadata screening, and do not claim true audio-language or source-aspect verification without a stronger supported signal.
