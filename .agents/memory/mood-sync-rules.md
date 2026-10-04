---
name: Mood Sync rules
description: Required hair identities and handling unavailable expression variants.
---

The user defines Spiky as Male and Ponytail as Female for Mood Sync. Facial
messages must never change that hair identity. Non-face emojis must not reset
the active mood.

**Why:** The user explicitly requested hair-identity checks, supported facial
expressions only, persistent mood, and preservation of room/account logic.

**How to apply:** When adding artwork or expanding supported faces, use only
the matching hairstyle. If its artwork is missing, ignore that face rather
than substituting the opposite hairstyle. The chosen multi-face policy is
last qualifying face wins, so trailing unsupported emojis cannot reset it.

Add new mood artwork as a new selectable picture rather than overwriting an
existing saved picture; use it for future qualifying chat messages.

**Why:** Existing selections and active moods must remain stable until the user
changes their picture or sends a new qualifying face, as requested.

**How to apply:** Preserve older artwork and saved choices when adding a newly
supplied version of an already-supported expression.

Keep existing artwork only for unmatched expressions; the user will supply
the missing Ponytail 😭, Spiky 🥹, Spiky 😜, and Ponytail 🤨 variants.

**Why:** The user chose "Keep existing artwork only" and stated "I will add the 4."

**How to apply:** Do not generate or substitute artwork for these missing
variants. Add it when supplied, without changing saved selections. Keep the
normalized moods for 😉 and 😜 separate so their distinct artworks are preserved.