---
name: Photo visibility cache precedence
description: A fresh hidden-photo response must not be overridden by an older cached image.
---

When a fresh server response hides a profile photo, show initials. Do not fill
that missing photo from an older Favorites, discovery or profile response.

**Why:** A photo can become rejected, flagged, or otherwise unavailable while
another endpoint still has a previously approved image cached. Reusing that old
image would undermine the owner's photo-review rules, even though image fetching
also has server-side authorization.

**How to apply:** Treat an explicit null photo in the current response as an
authoritative visibility decision. Reuse the neutral initials fallback and let
the server determine when a photo is eligible again.
