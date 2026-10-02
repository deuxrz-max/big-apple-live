# Headless room audio

`RoomAudioClient` adds browser WebRTC microphone audio to an existing room
session. It creates no visible UI and has no React, emoji, or audio-routing
library dependencies. Microphone audio travels directly between room peers.

Use HTTPS (or localhost), a browser with WebRTC, and initiate capture from a user
action. If embedded in an iframe, the host must permit microphone use and
playback. This SDK does not bypass permission prompts.

## Basic usage

```js
import { RoomAudioClient } from "/api/room-audio.js";
// Workspace consumers may instead import from "@workspace/room-audio".

// Room creation is unchanged; joining uses /api/rooms/{roomId}/join.
const response = await fetch("/api/rooms", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ displayName: "Alex" }),
});
if (!response.ok) throw new Error("Could not create room");
const session = await response.json();

const audio = new RoomAudioClient({
  roomId: session.room.roomId,
  participantSessionId: session.participantSessionId,
  baseUrl: "/api",
  onState: (state) => { /* idle, requesting-microphone, ready, connecting,
                          connected, reconnecting, error, closed */ },
  onPeerState: (participantId, state) => { /* RTCPeerConnectionState */ },
  onError: (error) => { /* use error.code for actionable handling */ },
  // iceServers: [{ urls: "turn:your-turn-server", username, credential }],
});

await audio.start();  // Capture granted; observe callbacks for peer connection.
// await audio.resumePlayback();  // From a user action if autoplay was blocked.
// audio.reconnect();             // Reuse room membership; rebuild peer audio.
// await audio.stop();            // Stop only audio and its heartbeat timer.
// await audio.leave();           // Stop audio AND use the original room leave API.
```

Replace `/api` with the actual same-origin API prefix when embedding in another
artifact. Treat `participantSessionId` as a private capability: do not put it in
URLs, room invites, diagnostics, logs, or public storage. Invitations use only
the unique Room ID. No user identity/account authentication has been added.

## Joining, leaving, and reconnection

- Create/join a room using the original endpoints, then construct this client.
  Each device should have its own independently joined participant session.
- `start()` first requests audio-only capture. If denied, it rejects with
  `microphone-denied`, retains no media, and does not change room membership.
  Enable permission and call `start()` again to retry.
- While audio is running, the client uses the existing heartbeat endpoint every
  30 seconds. An idle signaling stream does not extend presence on the server.
- A signaling interruption closes stale peers and retries with backoff, up to
  five consecutive short-lived failures. A new stream rebuilds connections with
  new generation IDs. Manual `reconnect()` follows the same mechanism.
- Peer negotiation, ICE gathering, and sustained disconnection have timeouts.
  Failed peer connections report `peer-connection-failed` and rebuild signaling.
- A superseded device receives `session-in-use` and stops rather than repeatedly
  replacing the other device. Join as a separate session to use another device.
- Room leave/expiry produces `session-expired`; rejoin explicitly instead of
  silently creating a different participant.
- `stop()` closes peer connections, remote playback, local tracks, streaming,
  retries, and the client heartbeat timer. It preserves room membership until
  its existing lease expires; a caller can continue the original heartbeat if
  remaining in the room without audio.
- `leave()` stops local resources even if the network fails, and calls the
  original room leave endpoint. A rejected leave indicates the server operation
  could not be confirmed; the existing heartbeat timeout remains the fallback.

## Errors and diagnostics

| Code | What the caller should do |
| --- | --- |
| `unsupported` | Use HTTPS and a WebRTC-capable browser. |
| `microphone-denied` | Enable microphone permission; retry from a user action. |
| `microphone-unavailable` | Check the device/input; restart capture. |
| `playback-blocked` | Call `resumePlayback()` from a user action. |
| `session-expired` | Join the room again to obtain a new private session. |
| `session-in-use` | Use a separate participant session for another device. |
| `signaling-unavailable` | Transient interruptions retry; after state `error`, call `start()` to retry. |
| `peer-connection-failed` | Recovery is automatic; persistent network failure may require TURN. |

`getDiagnostics()` returns state, microphone activity, and public peer details
without private credentials. `getPeerStats()` returns WebRTC RTP bytes and
received audio energy for tests/debugging, not raw audio or recordings.

## Networking and privacy

The default uses public Google STUN. Supply `iceServers: []` for local-only
tests, or your own STUN/TURN configuration for deployment. Use short-lived TURN
credentials supplied securely by your own service; do not hardcode production
secrets in a browser bundle. No TURN provider or credentials are provisioned
automatically. Across restrictive networks, TURN is necessary.

WebRTC uses encrypted media transport. SDP/ICE can disclose network addresses to
the other participants. This is a small-room peer mesh, not a media server or an
SFU. Room and signaling state are still single-process and ephemeral; restarting
the API requires rejoining. No recording or persistent SDP history is added.