# We Buggin

Voice-first rooms with persistent named accounts, customizable static emoji
identities, live presence, and WebRTC audio.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server using workflow-provided PORT
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Room presence remains in memory. Account names/emoji profiles persist in PostgreSQL; Clerk owns account authentication.
- `pnpm --filter @workspace/we-buggin run dev` — web app, using its managed workflow
- `pnpm --filter @workspace/api-server run test:rooms` — room and signaling unit tests
- `pnpm --filter @workspace/api-server run test:audio` — two-browser WebRTC/audio lifecycle test (running API and Playwright Chromium required)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM server and standalone browser SDK bundles)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract
- `artifacts/api-server/src/lib/room-store.ts` — room/session state
- `artifacts/api-server/src/routes/rooms.ts` — REST and server-sent events
- `artifacts/api-server/ROOMS.md` — lifecycle, API usage, and limitations
- `lib/room-audio/README.md` — headless audio SDK usage and error handling
- `artifacts/api-server/src/lib/audio-signaling.ts` — authenticated room-scoped SDP relay

## Architecture decisions

- Presence is deliberately ephemeral and single-process for this initial framework.
  This avoids treating database rows as evidence of a currently active user.
- Heartbeat leases are used instead of treating event-stream connections as identity;
  observing a room must not create or preserve a participant session.
- Public participant IDs differ from private session credentials.
- Audio membership is separate from room presence so microphone denial or
  signaling reconnects cannot create duplicate room participants.
- Signaling uses authenticated fetch-based SSE plus targeted SDP POSTs to reuse
  the existing transport without putting credentials into stream URLs.
- Peer audio is a small-room mesh. Stream generations fence stale messages and
  deterministic offer direction avoids negotiation glare.

## Product

Users can create a room with a unique shareable ID, join by ID, keep an active
participant session, leave, and subscribe to live participant snapshots.
Participants can also exchange peer-to-peer microphone audio through the
headless SDK, with reconnection and permission/error handling.
Users chose persistent accounts so people can keep dedicated names.
Account names are reserved case-insensitively and kept after first claim.
Emoji identities use the OpenMoji library, Male/spiky hair or Female/ponytails,
and arbitrary six-digit body/hair colors. They are static presence anchors:
no lip-sync, mouth animation, or audio-driven avatar effects.
The supplied male spiked-hair and female ponytail portraits are visual references
for the identity styles. Each user can manually change their own facial expression
whenever they choose, including while in a room; expressions are not tied to gender.

## User preferences

Preserve existing room lifecycle, heartbeat, presence, unique IDs, and private
session credentials. Emoji/signup/room UI is now requested; avoid unrelated UI.

## Gotchas

- Restarting the API clears rooms and participant sessions.
- Multiple API instances require shared state and pub/sub first.
- Regenerate API types after OpenAPI changes.
- Native WebRTC requires HTTPS/localhost and microphone permission. Public STUN
  is not enough on every network; TURN can be supplied through SDK iceServers.
- Clerk cookie authentication applies to account/profile endpoints only. Do not
  interpret the audio SDK's private session Bearer capability as a Clerk JWT.
- Registered room identities must be derived on the server from the signed-in
  user's profile; never trust a posted name, account ID, or avatar as ownership.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
