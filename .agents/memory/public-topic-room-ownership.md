---
name: Public topic-room ownership
description: Beam TV ownership and playback rules for Streamtalk's public topic rooms.
---

Public topic rooms and their overflow rooms are ownerless for Beam TV. No participant receives TV controls or skip-vote controls; the server searches YouTube by the room's current displayed name and advances the shared queue automatically. Cache selected results, use only embeddable non-live, non-age-restricted videos, and keep the API key server-side. App moderators keep their separate moderation powers.

**Why:** The owner wants public viewing rooms to be community-run and fully automatic, with no participant controlling what everyone sees. During Beam TV playback, all room microphones are server-locked; the shared intermission is three minutes and unlocks them without overriding each person's saved mute choice.

**How to apply:** Apply automatic room-name search, playback timing, microphone lock and intermission only to configured public topic rooms and their overflow children. Do not add room-level search, playback, sound, skip or voting controls. Keep the YouTube key on the server, enforce mic policy through LiveKit, and preserve administrator or moderator permissions for chat moderation.
