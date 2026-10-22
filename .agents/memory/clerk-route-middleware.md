---
name: Clerk route middleware
description: Keep request identity helpers working on narrowly scoped authenticated API routes.
---

Any API route that calls Clerk identity helpers such as `getAuth` must be mounted under the app's Clerk middleware scope. A route can still be separately owner- or role-guarded after Clerk initializes the request identity.

**Why:** The development audio-harness account-list route called `getAuth` while its `/api/__dev/audio-harness` prefix was outside the scoped middleware, so an ordinary request became a 500 rather than an auth response.

**How to apply:** When adding an API router that uses `accountId(req)` or `getAuth`, add its prefix to the scoped middleware list in the server app bootstrap. Do not broaden auth middleware for routes that intentionally use private room capabilities instead of Clerk identity.

Confirm new protected prefixes with an actual unauthenticated HTTP request: an expected auth rejection is evidence the identity middleware ran; source-only handler tests can miss an omitted middleware prefix.

**Why:** Handler and UI source checks can pass while the running route still crashes before reaching its handler.
