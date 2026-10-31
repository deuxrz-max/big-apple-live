---
name: Android distribution scope
description: Owner's Android distribution requirements and boundaries.
---

The owner wants a downloadable Android app for direct APK testing, followed by Google Play closed testing. All testers are on Android; no iPhone version is needed. Requested application ID: com.bigapplelive.app.

The wrapper should load the published production site so most web fixes reach testers after publishing without a new binary. Never substitute the development preview address, publish to obtain a URL without permission, or change screens, features, gifts, rooms or prices as part of packaging.

**Why:** The owner explicitly requested Android-only distribution, remotely delivered fixes, production rather than development hosting, and no publishing during wrapper setup.

**How to apply:** Inspect current deployment metadata before configuring an origin. Treat a missing production address as a blocker, not permission to publish. Report APK/AAB and signing-key status accurately; do not call a configuration or proposed architecture a working Android app. Keep purchase integration read-only until separately authorized.
