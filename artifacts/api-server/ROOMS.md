# Room session API

This backend manages room state only. It does not route audio, send chat messages,
or provide UI or user accounts.

## Lifecycle

1. `POST /api/rooms` with `{"displayName":"Alex"}` creates a room and joins its
   creator as the first participant.
2. Share the returned `room.roomId`. Another participant sends the same body to
   `POST /api/rooms/{roomId}/join`.
3. Each response includes `participantSessionId`, a private, temporary session
   credential. Keep it private: it permits heartbeat and leave operations for
   that participant. It is **not** included in public participant snapshots.
4. Send `POST /api/rooms/{roomId}/participants/{participantSessionId}/heartbeat`
   every 30 seconds while active. Sessions expire after 90 seconds without a
   heartbeat, with background cleanup running every 5 seconds. Reads also remove
   expired sessions before returning state.
5. To leave immediately, send
   `DELETE /api/rooms/{roomId}/participants/{participantSessionId}`.

Room IDs are case-insensitive, collision-checked, 12-character hexadecimal codes.
Each join creates an independent session and public participant ID. Display
names need not be unique and are not verified identities.

## Live state

- `GET /api/rooms/{roomId}` returns `{roomId, createdAt, participants}`.
- `GET /api/rooms/{roomId}/events` opens a server-sent event stream. It immediately
  sends `room.snapshot`, and sends a fresh snapshot on joins, leaves, and expiry.
- `room.snapshot` data is the complete current room state, not a partial delta.
  Reconnect to receive a fresh snapshot; there is no event-history replay.
- The stream sends keepalive comments every 15 seconds.
- Streaming alone does not keep a participant active. Continue sending the
  participant heartbeat even while subscribed.
- When an empty room expires, the stream sends `room.expired` with `{roomId}`
  and closes.

Example event:

```text
event: room.snapshot
data: {"roomId":"A12B34C56D78","createdAt":"2026-10-02T12:00:00.000Z","participants":[]}
```

## Storage and limits

State lives in memory in **one server process**. Server restarts clear all rooms
and sessions. Empty rooms remain joinable for one hour, then expire. No database
is needed for this initial session framework. A shared state store and pub/sub
are required before using multiple API instances.

There are limits of 10,000 rooms, 100 participants per room, and 100 event
subscribers per room. Slow streaming consumers are disconnected to bound memory
usage. Missing rooms/sessions return 404, invalid input returns 400, full rooms
return 409, and service/subscriber capacity returns 503.

Anyone with a room ID can inspect or join it. Room IDs are locators, not access
control. Account authentication, private-room authorization, and abuse/rate
limits are separate future concerns.