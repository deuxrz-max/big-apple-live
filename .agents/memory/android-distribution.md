---
name: Android distribution scope
description: Owner's Android distribution requirements and boundaries.
---

The owner wants a downloadable Android app for direct APK testing, followed by Google Play closed testing. All testers are on Android; no iPhone version is needed. Requested application ID: com.bigapplelive.app.

The wrapper should load the published production site so most web fixes reach testers after publishing without a new binary. Never substitute the development preview address, publish to obtain a URL without permission, or change screens, features, gifts, rooms or prices as part of packaging.

**Why:** The owner explicitly requested Android-only distribution, remotely delivered fixes, production rather than development hosting, and no publishing during wrapper setup.

**How to apply:** Inspect current deployment metadata before configuring an origin. Treat a missing production address as a blocker, not permission to publish. Report APK/AAB and signing-key status accurately; do not call a configuration or proposed architecture a working Android app. Keep purchase integration read-only until separately authorized.

The owner explicitly chose a Trusted Web Activity with Google Play App Signing and forbids the agent from publishing or republishing to complete verification.

**Why:** A remotely hosted app should use the real browser for media and social sign-in, while the owner retains control of releases.

**How to apply:** Distinguish the direct-install/upload certificate from Google's app-signing certificate. Website Digital Asset Links must include both for direct and Play installations. Only public certificate fingerprints belong in source. A private backup in the same workspace is not an off-site key backup; instruct the owner to download and protect it. Never present private signing material through Library.
