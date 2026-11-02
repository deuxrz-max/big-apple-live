---
name: People search visibility
description: People search ignores discovery opt-in while retaining blocking and separate contact preferences.
---

Signed-in users can find other accounts by partial display name or @ID without discovery opt-in. Country filters still apply; self and bilateral blocks are excluded. Search results show public photo, display name, ID and level only.

**Why:** The owner explicitly requested account-wide People search rather than opt-in discovery.

**How to apply:** Keep search/public profile visibility separate from following and messaging permissions. Do not remove discovery restrictions from unrelated contact or leaderboard paths just to make search work. Preserve the production exclusion of development-only fixture accounts.
