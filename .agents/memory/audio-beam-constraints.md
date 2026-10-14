---
name: University beam transport decisions
description: Public room beam seats are audio-only; separate creator Go Live streams use LiveKit.
---

The owner's current room beam is audio-only: speakers join one of eight microphone seats, and camera access is never requested there. Camera broadcasting is a separate Go Live feature, started only by an explicit user action with LiveKit media tokens made on the server. Viewers can subscribe to the creator stream and publish chat data, but cannot publish audio or video. A user must not transmit a beam microphone and creator-stream microphone at the same time: Go Live is blocked if their beam mic is active; when it starts while the beam mic is locked or muted, the beam mic is muted and must be manually re-enabled after Go Live ends.

**Why:** the owner changed the beam to audio-only while retaining LiveKit solely for independent camera broadcasts, and required the two microphone paths not to clash.

**How to apply:** never add camera capture or camera permission prompts to speaker seats. Keep Go Live consent-triggered, tokens server-only, viewers subscribe-only for A/V, and server-side checks around microphone exclusivity.

The former P2P audio design and its connection-scoped speaker/listener signaling are historical only. If that older feature is explicitly restored later, keep a signaling connection's role fixed for its lifetime: a listener can reserve a slot before a microphone prompt, and the listener disconnect during handoff must not release the reservation.

**Why:** changing an existing listener connection's role at reservation time caused its normal handoff close to release the slot before the new speaker connection established.

**How to apply:** do not reuse this signaling behavior for LiveKit; apply it only if the owner explicitly reverts to the prior audio-only implementation.

The LiveKit frame colors are synchronized: hot pink → purple → electric blue → cyan, eight seconds per color (32 seconds for a full cycle). Empty slots use the same cycle at lower intensity; reduced-motion users get a static pink-purple border.

**Why:** the owner approved the described neon frame and requested smooth color changes without battery-heavy effects.

**How to apply:** keep the frame CSS-driven and reduced-motion aware; verify the one-, two-, and four-speaker grid arrangements at mobile widths.
