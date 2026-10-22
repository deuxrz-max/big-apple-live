---
name: Card-game room scope
description: Product boundary for card-game dealing, display and private testing.
---

The Deux Wild card game, its visible profile-card popup, and the owner-only one-minute test mode belong only in user-created no-TV social rooms. Do not add card UI, test controls, dealing, or game-display API access to themed/video rooms or livestreams.

**Why:** The user changed the product scope because seat-microphone use can mute room-video audio; cards should not interfere with those rooms.

**How to apply:** Keep schedulers, card endpoints, profile-hand display, and private test-mode entry points scoped to user-created social rooms. Preserve existing seating, microphone/audio, video, chat, and gifts in every other room type.

The owner replaced the four twos with four distinct Jokers in the uploaded deck: 48 regular cards plus four wild Jokers, 52 total. Preserve the existing logo card backs.

**Why:** The user explicitly chose Jokers instead of twos and supplied replacement artwork.

**How to apply:** Use Jokers for wildcard logic, rules, hand guides and shimmer. Do not reintroduce physical two cards. A Joker can still represent rank two when evaluating an ace-low straight.

Prioritize card readability over a large profile header in created-room profile popups. Use the available phone screen for full-face inspection, not just a small centered fan.

**Why:** The owner could not read the heavily overlapped cards and explicitly said the old popup looked half empty. Enlarging the container alone leaves too much unused space around a width-constrained fan.

**How to apply:** Keep the identity header compact and a large readable full-card view alongside hand selection. Preserve the fan and Joker shimmer, without changing other room menus.
