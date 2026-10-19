---
name: Room gift display receipts
description: Keep shared gift animation delivery independent from gift payout and inventory classification.
---

Every successful gift send made from a room context needs a persisted room animation event, regardless of the legacy room-gift classification. Keep that classification for the existing payout split and recipient inventory rules; do not use it as a gate for showing a sent gift.

**Why:** The room catalog exposed active gifts whose sends were accepted and charged, but the event insert was conditional on a different hardcoded gift classification. The sender and other room members therefore had no receipt to animate.

**How to apply:** When changing gift send behavior, record the room event in the same transaction as the charge, then preserve the current gift-specific payout and inventory branches.
