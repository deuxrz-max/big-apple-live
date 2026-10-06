---
name: Room mood visuals
description: Preserve the additional visual-effects transport without replacing chat or avatar behavior.
---

Room mood effects are an additional read-only transport, not a replacement chat system. Broadcast effects only after accepted chat has committed, and isolate them by room incarnation.

**Why:** The user requested synchronized Socket.io visuals without rewriting existing chat, login, or profile/avatar logic. The existing chat uses authenticated SSE, so the visual Socket.io connection deliberately coexists with it.

**How to apply:** Keep speculative sender-only effects out of the chat composer. The server owns bursts and room mood. Changes to visual notifications must preserve ongoing microphones and must not leak chat-derived events through public roster streams.
