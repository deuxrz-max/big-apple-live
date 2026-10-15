---
name: Live stream chat startup
description: The ordering and recovery requirements for host live-session chat EventSource connections.
---

The live chat EventSource can request before a newly created host session has transitioned from `starting` to `live`. The API rejects that request with 404; the first host heartbeat can make the lease live moments later. A native EventSource does not necessarily retry after a terminal 404, so clearing the UI notice on `open` alone is insufficient.

**Why:** Preview logs showed the chat-events request returning 404 before the first successful host heartbeat. This produced a persistent reconnect state and, without a manual reconnect, left chat disconnected after the lease became live.

**How to apply:** For host streams, establish and confirm a heartbeat before mounting the chat EventSource. On EventSource errors, let normal `CONNECTING` retries proceed, but explicitly recreate a source that reaches `CLOSED` using bounded backoff. Clear the reconnect notice on `open`, and keep signed-in end-to-end verification separate from unauthenticated preview captures.

The LiveKit room effect owns the camera tracks as well as the connection. Its cleanup must depend on stream identity and stable inputs, not callbacks recreated by parent renders; otherwise harmless profile refreshes can disconnect the room, stop the camera and let the heartbeat lease expire. Preserve the last successful profile/access gate state on live routes during transient refresh errors, while still enforcing sign-in, age confirmation and actual suspension responses.

**Why:** The October 14 working camera capture requested 1280×720 and let the full-screen video element crop to cover. A later forced 720×1280 sensor request plus callback-driven effect cleanup were plausible causes of mobile camera failure and reconnect loops.

**How to apply:** Prefer the known-working camera constraints unless a device test proves otherwise. Keep local track publishing after LiveKit connects, retain the `object-fit: cover` full-screen display, and use latest-callback refs so UI renders do not restart the stream.
