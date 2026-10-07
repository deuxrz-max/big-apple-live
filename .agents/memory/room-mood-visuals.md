---
name: Room mood visuals
description: Preserve the additional visual-effects transport without replacing chat or avatar behavior.
---

Room mood effects are an additional read-only transport, not a replacement chat system. Broadcast effects only after accepted chat has committed, and isolate them by room incarnation.

**Why:** The user requested synchronized Socket.io visuals without rewriting existing chat, login, or profile/avatar logic. The existing chat uses authenticated SSE, so the visual Socket.io connection deliberately coexists with it.

**How to apply:** Keep speculative sender-only effects out of the chat composer. The server owns bursts and room mood. Changes to visual notifications must preserve ongoing microphones and must not leak chat-derived events through public roster streams.

Autonomous scene timing is separate from dominant-emoji selection.

**Why:** Rooms should feel alive without messages, while retaining the user's original rolling three-minute emoji-mood requirement.

**How to apply:** Share scene timing and seeds from the server. Do not accelerate or replace emoji selection just to animate quiet rooms, and do not use fabricated chat messages to trigger visual events.

Reduced-motion visuals must stay steady across room-energy updates, not just stop their animation loop.

**Why:** Browser verification found that periodic energy updates still changed canvas brightness after continuous animation had stopped.

**How to apply:** Use a steady decorative intensity in reduced-motion mode while continuing to receive shared room state.
