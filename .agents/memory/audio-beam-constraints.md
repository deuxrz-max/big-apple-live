---
name: Eight-seat audio/video split
description: Mic-on seats hear other mic-on seats and locally mute room video; listeners receive video only.
---

The owner's current room beam is audio-only: speakers join one of eight microphone seats, and camera access is never requested there. Tapping one's occupied seat toggles their microphone. Mic-on participants hear other mic-on seats and locally mute only their own Beam TV sound; mic-off speakers and audience listeners cannot subscribe to seat audio and continue hearing the video. Changing this local sound mode never pauses, seeks, or restarts the shared video timeline. Camera broadcasting is a separate Go Live feature, started only by an explicit user action with LiveKit media tokens made on the server. A user must not transmit a beam microphone and creator-stream microphone at the same time: Go Live is blocked if their beam mic is active; when it starts while the beam mic is muted, the beam mic is muted and must be manually re-enabled after Go Live ends.

**Why:** the owner explicitly requested the mic toggle to control both seat-conversation participation and only that user's video sound, while preserving continuous playback and the separate Go Live microphone restriction.

**How to apply:** never add camera capture or camera permission prompts to speaker seats. Keep Go Live consent-triggered, tokens server-only, audience and mic-off subscriptions excluded from seat audio, and server-side checks around microphone exclusivity.

The former P2P audio design and its connection-scoped speaker/listener signaling are historical only. If that older feature is explicitly restored later, keep a signaling connection's role fixed for its lifetime: a listener can reserve a slot before a microphone prompt, and the listener disconnect during handoff must not release the reservation.

**Why:** changing an existing listener connection's role at reservation time caused its normal handoff close to release the slot before the new speaker connection established.

**How to apply:** do not reuse this signaling behavior for LiveKit; apply it only if the owner explicitly reverts to the prior audio-only implementation.

The LiveKit frame colors are synchronized: hot pink → purple → electric blue → cyan, eight seconds per color (32 seconds for a full cycle). Empty slots use the same cycle at lower intensity; reduced-motion users get a static pink-purple border.

**Why:** the owner approved the described neon frame and requested smooth color changes without battery-heavy effects.

**How to apply:** keep the frame CSS-driven and reduced-motion aware; verify the one-, two-, and four-speaker grid arrangements at mobile widths.
