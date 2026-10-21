---
name: Card-game room scope
description: Product boundary for card-game dealing, display and private testing.
---

The Deux Wild card game, its visible profile-card popup, and the owner-only one-minute test mode belong only in user-created no-TV social rooms. Do not add card UI, test controls, dealing, or game-display API access to themed/video rooms or livestreams.

**Why:** The user changed the product scope because seat-microphone use can mute room-video audio; cards should not interfere with those rooms.

**How to apply:** Keep schedulers, card endpoints, profile-hand display, and private test-mode entry points scoped to user-created social rooms. Preserve existing seating, microphone/audio, video, chat, and gifts in every other room type.
