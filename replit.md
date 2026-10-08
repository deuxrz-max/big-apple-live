# We Buggin

Adults-only social chat universities with existing named accounts, users' uploaded
profile photos, persisted messages, live presence and independent university atmosphere.

## Current product: text chat

The main experience is six independent universities labeled LiveMe, Bigo
Live, Tango Live, TikTok, Instagram Live and Super Live, in that order. They are not broadcast integrations
and must not be presented as affiliated/endorsed. Preserve users, Clerk login,
existing accounts, messages and profile logic. Do not reactivate broadcasting
seats, camera/microphone prompts or the old twelve-seat cap in active routes.

Use "university/universities" in user-facing text; preserve internal room IDs/routes/events.
These are social spaces for optional sharing/learning broadcasting techniques, not
mandatory lessons, courses or enrollment.
Users upload their own profile photos; missing photos use neutral initials.
Each profile may keep up to four saved photos and select one main photo. The
“+ Click to add” control uploads photos; all saved photos appear on the profile.
Every app screen has fixed bottom navigation: Home, Follow, Message and Me,
without a video button. Use existing Directory, favorites, inbox and Edit Profile
routes; signed-out visitors can sign in to use the protected destinations.
The cap applies to selected profile photos, not lifetime uploads. Preserve all
selected photos during retention cleanup; removed photos keep the approved
30-day unused grace period.
Chat message authors use clickable names linking to their existing profiles, with
no profile photo beside the message author. Preserve profile privacy/block rules.
No branded characters, hair/portrait pickers or profile-image facial-emoji sync
in active routes. Chat emojis never change photos. Leave obsolete database
identity fields unused for compatibility; never overwrite genuine uploaded photos.
Existing valid profiles are complete; setup resumes only when no saved profile exists.
University atmosphere is separate from profile photos.
Tone-based scenes stay disabled without an approved classifier; activity is not
hostility. Final video assets are not supplied. Existing financial data requires
a separate policy decision and must never be erased or silently redesigned.
See `artifacts/api-server/CHAT-PIVOT.md` for retention limitations, migration,
configuration, safety and rollback details.

The historical sections below describe archived features retained for rollback;
they do not override the current text-chat product scope.

## Archived Beam frontend (rollback reference)

The default entry now hosts a frontend-only beam demo: React/TypeScript, a dynamic
black background with subtle slow ambient motion, high-contrast white chrome and
one electric-blue accent, bold condensed typography, and no heavy decoration.
Respect reduced-motion preferences. Beam setup offers 2, 4, 9 or 12 total spots,
including the host. Enforce the chosen room capacity; 12 is the maximum, not the
only room size. The setup starts with a seat-layout preview and selector, inspired
by the user's pre-live reference. Participants use
the supplied illustrated profile pictures, selected manually with their backgrounds
removed to transparency; preserve the faces and full hairstyles, and do not add
emoji/SVG hair overlays. Avatars remain static, while emoji
reactions remain available. Message history is bounded, with no
feed or infinite scrolling. Mock participants and local-only messaging must always
be identified as a demo, not presented as a real network connection.

**Why:** The user explicitly requested an interactive, backend-independent
streetwear-inspired frontend ready to connect to a backend later. Keep its mock
storage separate from real accounts, reserved names, and private room sessions.
The user subsequently requested a dynamic black beam background and background-free
profile images; this replaces the earlier white beam theme, not the legacy account UI.

The frontend lives in `artifacts/we-buggin/src/beam/`; its README documents the
service boundary. Existing account and voice rooms remain at `/user-portal` and
`/rooms/:roomId`, with the previous entry available at `/legacy`.

## Post-signup home

After account creation, greet users on a protected discovery home at `/home`,
inspired by the user's two-column LiveMe reference with bottom navigation.
Keep the dynamic black We Buggin theme and transparent, static portraits.
First-time profile/name claims also return to this home; profile editing stays
in the existing account portal. The discovery home must label browser-local beam
examples as demos, never invent live streams, viewer counts, notifications or
direct messages. Following demo beams is a device-local preference isolated by
signed-in account, not a server-side social relationship.

**Why:** The user requested a discovery-style greeting after creating an account.
Real accounts and voice-room capabilities remain separate from the beam demo.
Root authentication callbacks must let Clerk finish its handshake before showing
the public demo or redirecting the signed-in user to discovery.

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
