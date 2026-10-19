---
name: Gift catalog test isolation
description: Keep integration tests independent of owner-managed gift names, prices, and product types.
---

Gift-send tests must not assume the built-in gift catalog's default prices or product types when using the shared development database. Owner-managed settings can rename gifts, change prices, or switch an item between gift and entrance-effect status.

**Why:** Tests using fixed default costs failed against valid saved catalog overrides, and an old test tried to send an item that is currently configured as an entrance effect. Changing real catalog rows to satisfy a test would alter the owner's app.

**How to apply:** Seed and clean up isolated catalog settings or read the configured item within the fixture; never reset the shared catalog merely to make hard-coded expectations pass.
