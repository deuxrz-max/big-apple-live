# Shared Beam chat

Beam is mounted inside the existing Clerk provider at `/beams`,
`/beams/new`, `/beams/join`, and `/beams/:code`.

- `services/beamService.ts` calls generated account/profile and room APIs.
  Private participant capabilities use the existing per-account, per-tab room
  credential store. Chat requests contain only text and kind; the API requires
  both the authenticated account and its private room session.
- Beam creation adds a name and capacity (2, 4, 9, or 12) to the existing
  account-room API. Named Beams have six-character codes. Legacy voice rooms
  retain 12-character codes and their 100-person capacity.
- Accepted messages and normalized mood/artwork are committed together in
  PostgreSQL. Private history uses an immutable room incarnation ID, never a
  reusable share code. History returns the latest 60 messages. Authenticated fetch-based
  SSE broadcasts room snapshots and accepted chat, then reloads history on every
  reconnect. The writer applies the accepted HTTP response too. Legacy public
  presence streams do not expose private chat events.
- Account profiles own portraits and moods; there is no second profile store.
  Signup and dedicated-name reservation use the existing profile rules.
  Joining, reloads, ordinary text, and missing artwork never reset saved moods.
- Profile selection offers only **Male / Spiky hair** and **Female / Ponytail**,
  not the expression catalog or color customization. Selecting the same type
  preserves the existing picture and mood. A deliberate type change keeps the
  current mood if matching artwork exists, otherwise uses that type's neutral
  portrait. Expressions change through Mood Sync on qualifying chat faces.
- Shared mood rules live in `@workspace/beam-identity`. Spiky is Male and Ponytail
  is Female. Last supported matching face wins, with distinct 😉 and 😜 moods.
  Newly supplied Spiky 😜 and Ponytail 🤨 artwork is supported.
  Missing Ponytail 😭 and Spiky 🥹 remain unsupported.
  Do not generate artwork or substitute the other hairstyle.
- Supplied transparent artwork remains in
  `public/profile-pictures/transparent/`. Existing portrait IDs and deterministic
  legacy picture mappings are unchanged. Portraits remain static; no
  microphone-driven expression changes, SVG hair overlays, or animation.
- `legacyBeamService.ts` preserves the isolated browser-demo save format and
  regression tests. The live UI never imports the adapter. Its local key is left
  untouched; a saved portrait may be offered for explicit first-time account
  selection. Old mock messages and memberships are not uploaded as real chat.
- Room presence remains ephemeral, with the existing 90-second heartbeat lease
  and empty-room expiry. API restarts remove active rooms, but do not remove
  account moods or saved messages. Shared presence/pubsub across multiple server
  instances remains outside this change.

## Run and verify

Use the configured workflows for the app and API. From the workspace root:

- `pnpm run typecheck`
- `pnpm --filter @workspace/we-buggin run test:beams`
- `pnpm --filter @workspace/we-buggin run test:live` — reconnect/history merging
  and stale work across account changes.
- `pnpm --filter @workspace/api-server run test:rooms`
- `pnpm --filter @workspace/api-server run test:chat` — development database
  integration checks; creates synthetic profiles and deletes only its own rows.