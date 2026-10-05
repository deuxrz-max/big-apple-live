# We Buggin beam flow (frontend demo)

**Frontend demo / simulated participants.** No network, no auth, no audio. Mount `BeamApp` (default export) for `/` and `/beams/*`, outside Clerk. Routes: `/`, `/beams/new`, `/beams/join`, `/beams/:code`.

## Layout
- `types.ts` domain models, `BEAM_CAPACITIES = [2, 4, 9, 12]`, a maximum of 12, `BeamError`. Each room stores its selected total capacity, including the host, and enforces that limit for joins and simulation controls. Existing 12-person saves remain valid.
- `services/beamService.ts` the **mock adapter boundary**: in-memory store persisted to `localStorage` key `webuggin.beam.demo.v1`, with strict capacity, validation and a bounded history (60 messages). Seeded rooms: `LATEBG` (Late Night Buggin, 6 peers) and `FULL12` (full).
- `hooks/useBeam.ts` `useSyncExternalStore` bindings; UI never touches storage directly.
- `components/` BeamRoomLayout, ParticipantEmojiBadge, MessageList, MessageInput, EmojiPicker, CapacityIndicator, IdentityGlyph. The original component names are retained; identity components now display the user's supplied profile pictures, not Unicode emoji or SVG hairstyles.
- `portraits.ts` the 43 supplied pictures, including the original Kiss, Skeptical, Wink and Laugh choices plus ponytail, braid and spiked-hair expressions. Background-free lossless WebP copies in `public/profile-pictures/transparent/` are used by the shared renderer everywhere; original artwork in the parent directory is preserved. The profile picker offers only Male / Spiky hair and Female / Ponytail; expressions change through Mood Sync on a supported chat face. No microphone-driven expression changes or animated portraits. Adding artwork must not change the deterministic legacy mapping or existing saved selections.
- `Identity.portraitId` is the current picture choice. Legacy emoji/style/color fields are kept solely to read existing browser-local saves without losing sessions or messages. Old identities map deterministically to supplied portraits until a user chooses one.
- `beam.css` all styles scoped to `.beam-app` (and the `.bm-modal-back` portal-less overlay). Black surfaces with readable white text, blue accents and a slow ambient background; background motion stops for reduced-motion preferences. Portraits themselves do not animate.

## Mood Sync
Accepted text messages and quick reactions update only their sender's active
portrait in the same persisted room commit. Supported faces are laughing,
tears of joy, ROFL, heart-eyes, smiling with hearts, smiling eyes, melting, thinking, winking (😉), neutral, delighted, grinning, smiling and kissing for both hairstyles;
playful / silly wink (😜) supports both hairstyles and remains separate from 😉.
Skeptical / raised eyebrow (🤨) supports both hairstyles.
Grateful / deeply touched (🥹) requires ponytail artwork; loudly crying requires spiky artwork.
Spiky is the Male hair identity; Ponytail is Female. Missing matching variants,
hearts, flames, ordinary text and unsupported compound faces leave the mood alone.
The last qualifying face in a message wins. The mood survives reload with the
existing browser-local beam state; old history is not replayed on mount.
This does not change account profiles or the separate authenticated voice-room
logic. A future network chat adapter must derive the sender on the server and
broadcast/persist this identity update with the accepted message.

### Normalized mood state
`moodCatalog.ts` maps supported facial emojis to typed normalized mood keys and
maps each key to its available Spiky/Male and Ponytail/Female portrait IDs.
`Identity.style` remains the existing core hair identity; no new signup field or
selection screen is needed. `Identity.currentMood` is saved alongside
`Identity.portraitId` by the existing message commit. Avatar-type selection
preserves the current mood when matching artwork exists, otherwise selecting
the new type's neutral portrait. Selecting the same type preserves the image.
Old saves without `currentMood` remain valid and
their portraits are not replaced or reinterpreted on load.

The two missing variants are intentionally unsupported until supplied:
Ponytail 😭 and Spiky 🥹. A face without matching artwork is
skipped; the last supported face for that sender wins. No timer resets the mood.
Chat messages, participant tiles, and room previews already use the shared
`IdentityGlyph` renderer and the active portrait pointer, so no UI changes are needed.

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
