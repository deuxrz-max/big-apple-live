---
name: University beam transport decisions
description: The audio-only preference was explicitly superseded by an approved, real LiveKit video beam.
---

The owner's current approved university-room beam is real four-slot audio/video via LiveKit, with the host included in the four slots. This explicitly replaces the earlier audio-only/P2P preference for this feature; use the server-side LiveKit integration and existing Replit Secrets, never expose the API secret to a browser. Audience tokens are subscribe-only; camera/microphone capture starts only after a person taps to join a speaker slot.

**Why:** on 2026-10-12 the owner explicitly changed the plan back to a real LiveKit-powered Video Beam and supplied the three LiveKit secret names. The latest feature decision takes precedence over the previous cost-avoidance/P2P choice.

**How to apply:** preserve the four-person limit including the host; create signed tokens on the server only, enforce subscribe-only audience permissions, and make host media controls revoke publication server-side. Do not ask for any other paid-service credentials or purchase service plans.

The former P2P audio design and its connection-scoped speaker/listener signaling are historical only. If that older feature is explicitly restored later, keep a signaling connection's role fixed for its lifetime: a listener can reserve a slot before a microphone prompt, and the listener disconnect during handoff must not release the reservation.

**Why:** changing an existing listener connection's role at reservation time caused its normal handoff close to release the slot before the new speaker connection established.

**How to apply:** do not reuse this signaling behavior for LiveKit; apply it only if the owner explicitly reverts to the prior audio-only implementation.

The LiveKit frame colors are synchronized: hot pink → purple → electric blue → cyan, eight seconds per color (32 seconds for a full cycle). Empty slots use the same cycle at lower intensity; reduced-motion users get a static pink-purple border.

**Why:** the owner approved the described neon frame and requested smooth color changes without battery-heavy effects.

**How to apply:** keep the frame CSS-driven and reduced-motion aware; verify the one-, two-, and four-speaker grid arrangements at mobile widths.
