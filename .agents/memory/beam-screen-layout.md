---
name: Beam screen layout
description: User-requested fixed participant boxes and borderless scrolling chat.
---

Keep the Beam participant boxes anchored on screen. Chat belongs below them without a surrounding box; messages rise out of view at the bottom edge of the participant area, and older messages are reached by scrolling the chat.

**Why:** The user explicitly requested this layout and supplied a LiveMe screenshot as a composition reference, not a request to replace Streamtalk's theme.

**How to apply:** Keep participant positions independent of chat length and chat scrolling. Preserve the existing branding and room controls; do not restore a document-scrolling roster or a framed chat panel.

Room confirmation notices must float above the layout rather than consume stage height.

**Why:** An in-flow identity notice, combined with a tall mobile header, collapsed the chat viewport and clipped participant avatars on short screens.

**How to apply:** Keep notices dismissible and accessible without moving the roster; reserve visible space for both messages and the composer on short screens.
