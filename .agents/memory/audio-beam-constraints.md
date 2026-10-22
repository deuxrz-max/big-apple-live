---
name: Room audio/video split
description: Mic-on seats hear other mic-on seats and locally mute room video; listeners receive video only.
---

Every room type is audio-only, including user-created no-TV rooms and themed/TV rooms. Keep nine seats, showing profile photos/avatars and speaking indicators, never seat camera feeds. Only full-screen Go Live broadcasts allow camera video. Tapping one's occupied seat toggles their microphone. Mic-on participants hear other mic-on seats and locally mute only their own Beam TV sound; mic-off speakers and audience listeners cannot subscribe to seat audio and continue hearing the video. Changing this local sound mode never pauses, seeks, or restarts the shared video timeline. Camera broadcasting is a separate Go Live feature, started only by an explicit user action with LiveKit media tokens made on the server. A user must not transmit a beam microphone and creator-stream microphone at the same time: Go Live is blocked if their beam mic is active; when it starts while the beam mic is muted, the beam mic is muted and must be manually re-enabled after Go Live ends.

**Why:** the owner explicitly said "Video is for only go live full screen broadcasts" and kept the existing mic-driven conversation/video sound split.

**How to apply:** never add camera capture or camera permission prompts to speaker seats; disable previously published room camera tracks as well. Keep Go Live consent-triggered, tokens server-only, audience and mic-off subscriptions excluded from seat audio, and server-side checks around microphone exclusivity.

The former P2P audio design and its connection-scoped speaker/listener signaling are historical only. If that older feature is explicitly restored later, keep a signaling connection's role fixed for its lifetime: a listener can reserve a slot before a microphone prompt, and the listener disconnect during handoff must not release the reservation.

**Why:** changing an existing listener connection's role at reservation time caused its normal handoff close to release the slot before the new speaker connection established.

**How to apply:** do not reuse this signaling behavior for LiveKit; apply it only if the owner explicitly reverts to the prior audio-only implementation.

The LiveKit frame colors are synchronized: hot pink → purple → electric blue → cyan, eight seconds per color (32 seconds for a full cycle). Empty slots use the same cycle at lower intensity; reduced-motion users get a static pink-purple border.

**Why:** the owner approved the described neon frame and requested smooth color changes without battery-heavy effects.

**How to apply:** keep the frame CSS-driven and reduced-motion aware; verify the one-, two-, and four-speaker grid arrangements at mobile widths.
