---
name: Persistent preview test account boundaries
description: Owner-requested inspection accounts are not disposable regression fixtures or production seeds.
---

The owner requested persistent, sign-in-capable preview test accounts and sample
conversations to inspect personally. Keep these distinct from temporary regression
fixtures. Never seed them automatically during startup or publishing.

**Why:** These accounts are intended for the owner to look around the app, and
their messages to the owner's real preview account must remain unread until the
owner opens them. They are development-only test data, not real broadcasters.

**How to apply:** Regression tests should create and clean up their own isolated
fixtures, not bulk-delete accounts based on a test-like display name. Confirm the
provider's private test marker and the profile's explicit test-account bio before
any later cleanup. Do not sign in as the owner or open the owner's sample
conversations merely to verify delivery; use read-only counts instead.
