---
name: Audio beam constraints
description: Owner-approved transport and privacy constraints for Streamtalk university beams.
---

University beams are audio-only: no camera capture or camera permission. Prefer direct peer-to-peer audio with free connection helpers; do not add hosted or paid live-media services or request their credentials. If restrictive networks make a relay necessary, propose a self-hosted option and explain the tradeoffs before adding it.

**Why:** the owner changed the beam plan from video to audio-only, rejected services that could create future billing, and explicitly said not to ask for paid service keys.

**How to apply:** preserve the four-speaker-slot limit and use direct connections by default; clearly disclose that some NAT/firewall combinations may fail without TURN and that P2P host-mute relies on clients honoring the server's moderation event.

Keep a signaling connection's speaker/listener role fixed for that connection's
lifetime. A listener can reserve a beam slot before opening the browser's
microphone permission prompt; its disconnect during the subsequent handoff must
not be mistaken for the reserved speaker disconnecting.

**Why:** changing the existing listener connection's role immediately when a
slot was reserved caused its normal handoff close to release the slot before
the new speaker connection could establish.

**How to apply:** derive role when each signaling connection is established.
Test the sequence: connected listener → slot reservation → listener disconnect
→ slot remains held → new speaker connection. Microphone grant after the
explicit Join action starts the user's mic; permission failure releases the
reservation and keeps or restores the listener connection.

The university beam client must trickle ICE: send its SDP as soon as the local
description is set, relay each candidate separately, and queue remote candidates
until the remote description is installed. The legacy audio client still uses
its existing gathered-description flow. Headless Chromium with Google STUN has
now established P2P connections and nonzero RTP, but this does not verify real
phones or restrictive networks.

**Why:** waiting for ICE gathering to finish before sending SDP prevented any
peer negotiation in the browser harness. Trickle signaling resolved that
specific failure without adding a paid service or TURN.

**How to apply:** preserve room/connection validation for candidate relays,
test SDP and candidate exchange plus ICE/RTP metrics, and still verify on real
devices/networks before claiming mobile audio reliability. Do not add a TURN
provider or credentials without the owner's explicit approval.
