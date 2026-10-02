# We Buggin beam flow (frontend demo)

**Frontend demo / simulated participants.** No network, no auth, no audio. Mount `BeamApp` (default export) for `/` and `/beams/*`, outside Clerk. Routes: `/`, `/beams/new`, `/beams/join`, `/beams/:code`.

## Layout
- `types.ts` domain models, `BEAM_CAPACITIES = [2, 4, 9, 12]`, a maximum of 12, `BeamError`. Each room stores its selected total capacity, including the host, and enforces that limit for joins and simulation controls. Existing 12-person saves remain valid.
- `services/beamService.ts` the **mock adapter boundary**: in-memory store persisted to `localStorage` key `webuggin.beam.demo.v1`, with strict capacity, validation and a bounded history (60 messages). Seeded rooms: `LATEBG` (Late Night Buggin, 6 peers) and `FULL12` (full).
- `hooks/useBeam.ts` `useSyncExternalStore` bindings; UI never touches storage directly.
- `components/` BeamRoomLayout, ParticipantEmojiBadge, MessageList, MessageInput, EmojiPicker, CapacityIndicator, IdentityGlyph. The original component names are retained; identity components now display the user's supplied profile pictures, not Unicode emoji or SVG hairstyles.
- `portraits.ts` the 19 supplied pictures, including the original Kiss, Skeptical, Wink and Laugh choices plus ponytail, braid and spiked-hair expressions. Background-free lossless WebP copies in `public/profile-pictures/transparent/` are used by the shared renderer everywhere; original artwork in the parent directory is preserved. Selection is manual and static; no microphone-driven expression changes. Emoji messages/reactions are separate. Adding choices must not change the deterministic legacy mapping or existing saved selections.
- `Identity.portraitId` is the current picture choice. Legacy emoji/style/color fields are kept solely to read existing browser-local saves without losing sessions or messages. Old identities map deterministically to supplied portraits until a user chooses one.
- `beam.css` all styles scoped to `.beam-app` (and the `.bm-modal-back` portal-less overlay). Black surfaces with readable white text, blue accents and a slow ambient background; background motion stops for reduced-motion preferences. Portraits themselves do not animate.

## Plugging in a backend
Replace the functions exported from `beamService.ts` (`createBeam`, `joinBeam`, `leaveBeam`, `updateIdentity`, `sendMessage`, `checkJoinable`) with API calls, keeping the `BeamError` codes (`ROOM_FULL`, `NOT_FOUND`, ...) so the UI messages stay intact. Swap `subscribe`/`getState` for server state (websocket or query cache). The `simulate*` functions and the "simulated participants" panel in `RoomPage` are demo-only; delete them. Capacity must also be enforced server-side.

Make sends return success before clearing the composer. The mock adapter supports
one current self session: resuming a room does not duplicate it, and entering a new
room releases the previous seat. State is local to this browser; it is not a
cross-device or multi-user synchronization protocol. Unavailable storage displays
an explicit in-memory warning. Corrupted saved data is validated before loading.

## Run and verify
From the workspace root:
- `pnpm --filter @workspace/we-buggin run dev`
- `pnpm --filter @workspace/we-buggin run typecheck`
- `PORT=24150 BASE_PATH=/ pnpm --filter @workspace/we-buggin run build`
- `pnpm --filter @workspace/we-buggin run test:beams`
