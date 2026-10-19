---
name: Room and livestream gift receipts
description: Keep animation delivery independent from room-gift payout and inventory classification.
---

Every successful room-context send needs a persisted room animation event, and every successful livestream send needs a quantity-bearing event delivered to the shared live stream. Both include all active sendable gifts, regardless of the `roomGift` classification. Keep that classification only for the existing payout split and inventory rules; sendable catalog filtering already excludes entrance effects.

**Why:** The room catalog exposed active gifts whose sends were accepted and charged, but receipt creation was conditional on a different hardcoded gift classification. The same restriction blocked non-room-classified gifts in livestreams even though the sheet offered them.

**How to apply:** For rooms, record the receipt in the charge transaction; for livestreams, publish the returned event after the transaction commits. Preserve gift-specific payout and inventory branches without using them to gate animation delivery.
