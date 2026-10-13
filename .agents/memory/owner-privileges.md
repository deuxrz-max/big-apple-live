---
name: Streamtalk owner access
description: The Vampsquad account alone has full owner/admin and preview test privileges.
---

For Streamtalk, only the non-test account with username Vampsquad receives full owner/admin privileges and preview test controls. Test-account markers do not grant privileged access.

**Why:** the user explicitly said Vampsquad is the only account with all privileges.

**How to apply:** Keep owner-only actions enforced on the server using the canonical Vampsquad profile, restrict preview test controls to development, and retain test-account markers without elevating those accounts.

Owner smoke tests also need `NODE_ENV=development` explicitly; one-off test runners may not inherit the API workflow's environment. Record the persisted equipped badge before testing and restore that exact value afterward.

**Why:** without the development environment, owner-only badge lookup returns no synthetic badges, which can make a test save the wrong equipped selection.

**How to apply:** Scope owner tests to development and restore the original persisted selection in `finally`; do not derive the restore value from owner-only badge lookup outside development.
