# Room session API

This backend manages room state and authenticated WebRTC signaling. A headless
browser SDK captures and plays peer audio. The server does not carry or record
audio or send chat messages. The Streamtalk web app now uses persistent Clerk
accounts and emoji identity profiles alongside this session framework.

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
guest names need not be unique and are not verified identities. Guest creation
or join rejects names reserved by a registered account with 409.

## Persistent accounts and emoji identity

- `GET /api/me` (Clerk cookie authentication) returns `{profile: null}` until
  identity signup is completed, then `{profile: {username, identity, updatedAt}}`.
- `PUT /api/me` saves `{username, identity}` for the authenticated account.
  Names use 3–24 ASCII letters/digits/underscore, are reserved case-insensitively,
  and cannot be renamed after first claim. Conflicting claims return 409.
- Identity is `{emojiId, gender: "Male" | "Female", color: "#RRGGBB",
  hairColor: "#RRGGBB"}`. The server validates the library ID and both arbitrary
  hex colors. Male uses spiky hair; Female uses ponytails in the static renderer.
- `GET /api/emojis` returns the real OpenMoji catalog.
  `GET /api/emojis/{emojiId}/{hexWithoutHash}/image` serves recolored static SVG.
- `POST /api/account/rooms` and
  `POST /api/account/rooms/{roomId}/join` derive name and identity from that
  signed-in user's saved profile. They do not accept client identity claims.
  Incomplete profiles return 409. Public snapshots contain `identity` and
  `isRegistered`, never Clerk account IDs or private session credentials.
- Each room response also includes the public `participantId` of the new
  participant, so clients identify themselves by ID, never by matching a name.
- Saving an emoji edit updates all active sessions owned by the account and
  broadcasts snapshots without changing participant IDs, audio generations,
  or heartbeat leases. Other accounts and guest sessions are unchanged.
- Account names and emoji profiles persist in PostgreSQL. Rooms remain
  ephemeral and single-process. Private room capabilities remain separate
  from cookie-based account authentication.
- Emoji avatars are presence indicators only, not lip-syncing voice avatars.
  Mic start/stop, WebRTC statistics, and audio activity never animate them.

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
control. Account identity is supported, but private-room authorization and
broader room abuse/rate limits remain separate concerns.

## WebRTC audio

The existing room endpoints and 90-second heartbeat leases are unchanged.
Audio signaling is an additional, authenticated layer. See
`lib/room-audio/README.md` for browser usage and error handling.

- `GET /api/room-audio.js` serves the standalone ES module `RoomAudioClient`.
- `GET /api/rooms/{roomId}/audio/events` opens the private signaling stream.
- `POST /api/rooms/{roomId}/audio/signals` sends a targeted SDP offer or answer.
- `DELETE /api/rooms/{roomId}/audio/connections/{connectionId}` stops audio
  without changing participant membership.
- All three audio operations require
  `Authorization: Bearer {participantSessionId}`. Credentials are not placed in
  query strings, SDP, public room state, signaling events, or request logs.
- The authenticated server derives the sender's public participant ID. It does
  not trust a sender ID supplied by a client. SDP goes to one current audio
  connection in the same room, never to public presence subscribers.
- SDP includes ICE candidates (non-trickle ICE). The participant with the
  lexically smaller public ID creates the offer, avoiding simultaneous offers.
- Every stream connection gets a new public `connectionId`. Both sender and
  target generations must match. Replacing a stream closes the old one;
  closing an old stream cannot remove its replacement.
- Leaving or lease expiry immediately removes audio peers and closes their
  streams. Losing only an audio stream does not change room presence.
- The server rate-limits SDP to 120 messages per connection per minute; SDP is
  limited to 12,000 characters. No SDP history is retained.

Authenticated stream events:

| Event | Data |
| --- | --- |
| `audio.ready` | `{self: {participantId, connectionId}, peers: [...]}` |
| `audio.peers` | `{peers: [...]}` (other connected audio participants) |
| `audio.signal` | `{from: {participantId, connectionId}, description: {type, sdp}}` |
| `audio.ended` | `{reason: "replaced" \| "participant-left" \| "disconnected"}` |

This is a peer-to-peer mesh for small rooms. Configure a TURN service in the
browser's `iceServers` for restrictive NATs/firewalls. Public STUN alone is not
a guarantee that two arbitrary networks can exchange audio. For large rooms,
an SFU architecture is a separate extension.

## Tests

- `pnpm --filter @workspace/api-server run test:rooms` — room lifecycle,
  room-scoped signaling, private credentials, stale generations, leave/expiry.
- With the API workflow running:
  `pnpm --filter @workspace/api-server run test:audio` — two browser participants
  using synthetic microphone input exchange real WebRTC audio packets, reconnect,
  and leave with capture/playback cleaned up; microphone denial is also checked.
- If Chromium is not installed for Playwright:
  `pnpm --filter @workspace/api-server exec playwright install chromium`.
  `ROOM_AUDIO_TEST_BASE_URL` can point the test at the development app origin.