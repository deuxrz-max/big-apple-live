---
name: Microphone permission rules
description: Creator-versus-visitor microphone scope and remote unmute consent.
---

The user wants microphone controls in both Beams and the separate live voice-room experience. The creator can control participants' microphones; visitors have controls only for their own microphone.

**Why:** The user explicitly requested creator-versus-visitor permissions and selected both room experiences.

**How to apply:** Enforce permissions on the server, not merely by hiding buttons. Do not change signup or room membership to implement microphone controls.

Remote unmute is a request that the visitor must explicitly accept; it must never start microphone capture automatically or bypass browser permission.

**Why:** Microphone capture is privacy-sensitive. The creator's request is not the microphone owner's consent.

**How to apply:** Default to silent capture until the owner's explicit action succeeds. Apply mute state to both local tracks and remote playback, including the standalone audio client, not only the React screen.
