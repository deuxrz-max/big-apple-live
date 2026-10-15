---
name: Live stream chat startup
description: The ordering and recovery requirements for host live-session chat EventSource connections.
---

The live chat EventSource can request before a newly created host session has transitioned from `starting` to `live`. The API rejects that request with 404; the first host heartbeat can make the lease live moments later. A native EventSource does not necessarily retry after a terminal 404, so clearing the UI notice on `open` alone is insufficient.

**Why:** Preview logs showed the chat-events request returning 404 before the first successful host heartbeat. This produced a persistent reconnect state and, without a manual reconnect, left chat disconnected after the lease became live.

**How to apply:** For host streams, establish and confirm a heartbeat before mounting the chat EventSource. On EventSource errors, let normal `CONNECTING` retries proceed, but explicitly recreate a source that reaches `CLOSED` using bounded backoff. Clear the reconnect notice on `open`, and keep signed-in end-to-end verification separate from unauthenticated preview captures.
