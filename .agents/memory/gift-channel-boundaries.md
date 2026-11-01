---
name: Gift channel boundaries
description: Gifts belong in rooms and live broadcasts, never direct or private messages.
---

No gift sending through direct/private messaging or context-free profile gifting. Explicitly keep gift buttons and gift-sending controls out of every direct-message screen, including the inbox, conversation actions and composer. Ordinary private messaging must continue working. Gifting remains available through validated room and live-broadcast contexts, with existing economics, sender progression and non-redeemable tester safeguards.

**Why:** The user explicitly said, “I don't want any gifts going through direct messaging.” Removing a button alone does not protect against older clients transferring coins.

**How to apply:** Reject context-free gift requests on the server before any debit, recipient credit, inventory consumption or idempotent replay. Do not reintroduce a generic profile/DM gift button. Do not change prices, cash-out conversion or balances as part of this channel restriction.
