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